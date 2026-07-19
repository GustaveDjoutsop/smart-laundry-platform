package com.smartlaundromat.payment.service.notification;

import com.smartlaundromat.payment.model.Transaction;
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
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.util.Map;
import java.util.function.Supplier;

/**
 * Calls spring-bot-manager-only's {@code POST /api/notifications/send} to push
 * a proactive WhatsApp message to a customer (Auth0 scope {@code sls-bot-admin}).
 * Mirrors {@link com.smartlaundromat.payment.service.machine.MachineStartService}'s
 * circuit-breaker/bulkhead pattern, but against the {@code botManagerService}
 * resilience4j instance so a slow/down bot service can't affect calls to
 * MachineStateService.
 */
@Slf4j
@Component
public class BotNotificationClient {

    private final RestTemplate restTemplate;
    private final CircuitBreaker circuitBreaker;
    private final Bulkhead bulkhead;
    private final String botManagerServiceUrl;
    private final String botId;

    public BotNotificationClient(@Qualifier("machineStateRestTemplate") RestTemplate restTemplate,
                                  CircuitBreakerRegistry circuitBreakerRegistry,
                                  BulkheadRegistry bulkheadRegistry,
                                  @Value("${bot-manager-service.base-url:http://localhost:8090}") String botManagerServiceUrl,
                                  @Value("${bot-manager-service.bot-id:laundry}") String botId) {
        this.restTemplate = restTemplate;
        this.circuitBreaker = circuitBreakerRegistry.circuitBreaker("botManagerService");
        this.bulkhead = bulkheadRegistry.bulkhead("botManagerService");
        this.botManagerServiceUrl = botManagerServiceUrl;
        this.botId = botId;
    }

    /**
     * Notifies the customer that their cycle is about to finish. Throws on
     * failure so the caller (CycleReminderService) can retry on its next poll.
     */
    public void sendCycleAlmostDone(Transaction tx, int minutesLeft) {
        postNotification(tx.getPhoneNumber(), "cycle_almost_done", Map.of(
                "machine", tx.getMachineId(),
                "minutes", minutesLeft
        ));

        log.info("Sent almost-done reminder: tx={}, machine={}, minutesLeft={}",
                tx.getExternalReference(), tx.getMachineId(), minutesLeft);
    }

    /**
     * Notifies the customer that their cycle has finished. Throws on failure
     * so the caller (CycleCompletionService) can retry on its next poll.
     */
    public void sendCycleCompleted(Transaction tx, String endTime) {
        String transactionId = tx.getExternalReference() != null ? tx.getExternalReference() : "unknown";
        postNotification(tx.getPhoneNumber(), "cycle_completed", Map.of(
                "machine", tx.getMachineId(),
                "endTime", endTime,
                "transactionId", transactionId
        ));

        log.info("Sent cycle-completed notification: tx={}, machine={}",
                tx.getExternalReference(), tx.getMachineId());
    }

    private void postNotification(String phone, String messageKey, Map<String, Object> params) {
        Map<String, Object> body = Map.of(
                "botId", botId,
                "phone", phone,
                "messageKey", messageKey,
                "params", params
        );

        String url = botManagerServiceUrl + "/api/notifications/send";
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(body, headers);

        Supplier<ResponseEntity<Map>> call = () -> restTemplate.postForEntity(url, entity, Map.class);
        call = Bulkhead.decorateSupplier(bulkhead, call);
        call = CircuitBreaker.decorateSupplier(circuitBreaker, call);
        call.get();
    }
}
