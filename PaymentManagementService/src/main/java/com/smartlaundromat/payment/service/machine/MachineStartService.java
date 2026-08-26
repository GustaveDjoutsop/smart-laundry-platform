package com.smartlaundromat.payment.service.machine;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.smartlaundromat.contracts.machine.MachineStartRequest;
import com.smartlaundromat.payment.model.OutboxEvent;
import io.github.resilience4j.bulkhead.Bulkhead;
import io.github.resilience4j.bulkhead.BulkheadRegistry;
import io.github.resilience4j.circuitbreaker.CircuitBreaker;
import io.github.resilience4j.circuitbreaker.CircuitBreakerRegistry;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.Map;
import java.util.function.Supplier;

/**
 * HTTP implementation of {@link MachineEventPublisher}.
 *
 * <p>Reads the {@code PaymentSucceeded} event payload from the outbox and
 * POSTs it to MachineStateService's {@code /api/machines/start-cycle} endpoint
 * with an Auth0 M2M Bearer token (scope {@code sls-machine-start}).
 * MachineStateService applies an idempotency check on {@code transactionReference}
 * before starting the machine, so duplicate deliveries are safe.
 *
 * <p>Called exclusively by {@link com.smartlaundromat.payment.service.OutboxRelayService}
 * — no longer called directly from PaymentService (P4, async outbox pattern).
 */
@Service
@Slf4j
public class MachineStartService implements MachineEventPublisher {

    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;
    private final CircuitBreaker circuitBreaker;
    private final Bulkhead bulkhead;

    @Value("${machine-state-service.base-url:http://localhost:8082}")
    private String machineStateServiceUrl;

    public MachineStartService(@Qualifier("machineStateRestTemplate") RestTemplate restTemplate,
                               ObjectMapper objectMapper,
                               CircuitBreakerRegistry circuitBreakerRegistry,
                               BulkheadRegistry bulkheadRegistry) {
        this.restTemplate    = restTemplate;
        this.objectMapper    = objectMapper;
        this.circuitBreaker  = circuitBreakerRegistry.circuitBreaker("machineStateService");
        this.bulkhead        = bulkheadRegistry.bulkhead("machineStateService");
    }

    /**
     * Publishes a {@code PaymentSucceeded} outbox event by POSTing to
     * {@code /api/machines/start-cycle}.
     *
     * <p>Throws on failure so {@link com.smartlaundromat.payment.service.OutboxRelayService}
     * can retry with backoff.
     */
    @Override
    public void publish(OutboxEvent event) throws Exception {
        Map<String, Object> payload = objectMapper.readValue(
                event.getPayload(), new TypeReference<>() {});

        String machineId = (String) payload.get("machineId");
        if (machineId == null || machineId.isBlank()) {
            log.warn("Skipping outbox event {} — missing machineId in payload", event.getId());
            return;
        }

        MachineStartRequest body = new MachineStartRequest(
                machineId,
                (String) payload.getOrDefault("cycleType", "NORMAL"),
                toInteger(payload.get("durationMinutes"), 30),
                toInteger(payload.get("pulseCount"), 1),
                (String) payload.getOrDefault("transactionReference", ""),
                (String) payload.get("reservationCode"),
                (String) payload.get("rfidCardUid"));

        String url = machineStateServiceUrl + "/api/machines/start-cycle";
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        HttpEntity<MachineStartRequest> entity = new HttpEntity<>(body, headers);

        Supplier<ResponseEntity<Map>> call = () -> restTemplate.postForEntity(url, entity, Map.class);
        call = Bulkhead.decorateSupplier(bulkhead, call);
        call = CircuitBreaker.decorateSupplier(circuitBreaker, call);
        call.get();

        log.info("Machine start dispatched: machine={}, tx={}",
                machineId, body.transactionReference());
    }

    /**
     * The outbox payload is read as an untyped {@code Map<String, Object>} (its own JSON
     * envelope, not the cross-service wire contract), so a JSON number here could be
     * deserialized as {@code Integer} or {@code Long} depending on Jackson's default
     * numeric-type resolution — {@link MachineStartRequest}'s fields are strictly
     * {@code Integer}, so this normalizes either into that. {@code value} may genuinely
     * be {@code null} (key absent, or present with an explicit JSON {@code null}), in
     * which case {@code defaultValue} applies — deliberately not left to a caller's
     * {@code Map.getOrDefault}, which only covers the absent-key case.
     */
    private static Integer toInteger(Object value, int defaultValue) {
        if (value == null) {
            return defaultValue;
        }
        return value instanceof Number number ? number.intValue() : Integer.valueOf(value.toString());
    }
}
