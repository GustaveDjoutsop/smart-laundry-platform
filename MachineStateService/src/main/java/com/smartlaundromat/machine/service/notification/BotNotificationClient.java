package com.smartlaundromat.machine.service.notification;

import com.smartlaundromat.machine.model.Reservation;
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
 * Mirrors PaymentManagementService's {@code BotNotificationClient}, against a
 * dedicated {@code botManagerService} resilience4j instance so a slow/down bot
 * service can't affect any future MachineStateService outbound calls.
 */
@Slf4j
@Component
public class BotNotificationClient {

    private final RestTemplate restTemplate;
    private final CircuitBreaker circuitBreaker;
    private final Bulkhead bulkhead;
    private final String botManagerServiceUrl;
    private final String botId;

    public BotNotificationClient(@Qualifier("botManagerRestTemplate") RestTemplate restTemplate,
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
     * Notifies the customer that their reservation slot starts soon. Throws on
     * failure so the caller ({@code ReservationReminderService}) can retry on
     * its next poll.
     */
    public void sendReservationUpcoming(Reservation reservation, int minutesBefore, String slotEndStr) {
        postNotification(reservation.getCustomerPhone(), "reservation_upcoming", Map.of(
                "machine", reservation.getMachineId(),
                "minutes", minutesBefore,
                "code", reservation.getReservationCode(),
                "slotEnd", slotEndStr
        ));

        log.info("Sent reservation-upcoming reminder: code={}, machine={}, minutesBefore={}",
                reservation.getReservationCode(), reservation.getMachineId(), minutesBefore);
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
