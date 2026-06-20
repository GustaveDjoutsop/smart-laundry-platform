package com.smartlaundromat.payment.service.machine;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
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

        Map<String, Object> body = Map.of(
                "machineId",            machineId,
                "cycleType",            payload.getOrDefault("cycleType",       "NORMAL"),
                "durationMinutes",      payload.getOrDefault("durationMinutes", 30),
                "pulseCount",           payload.getOrDefault("pulseCount",      1),
                "transactionReference", payload.getOrDefault("transactionReference", "")
        );

        String url = machineStateServiceUrl + "/api/machines/start-cycle";
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(body, headers);

        Supplier<ResponseEntity<Map>> call = () -> restTemplate.postForEntity(url, entity, Map.class);
        call = Bulkhead.decorateSupplier(bulkhead, call);
        call = CircuitBreaker.decorateSupplier(circuitBreaker, call);
        call.get();

        log.info("Machine start dispatched: machine={}, tx={}",
                machineId, payload.get("transactionReference"));
    }
}
