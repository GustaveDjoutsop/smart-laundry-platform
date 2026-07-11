package com.smartlaundromat.payment.service.machine;

import com.smartlaundromat.payment.exception.PaymentException;
import io.github.resilience4j.bulkhead.Bulkhead;
import io.github.resilience4j.bulkhead.BulkheadRegistry;
import io.github.resilience4j.circuitbreaker.CircuitBreaker;
import io.github.resilience4j.circuitbreaker.CircuitBreakerRegistry;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.function.Supplier;

/**
 * Talks to MachineStateService's reservation endpoints for the checks PaymentService
 * needs before charging a customer: whether a supplied reservation code is valid for
 * a machine, and (see the duration-aware overlap enforcement fix) whether the requested
 * cycle duration would run into someone else's upcoming reservation.
 *
 * <p>Fails closed, same rationale as {@link MachineAvailabilityClient}: if
 * MachineStateService can't be reached, reject rather than risk an unauthorized start
 * or a double-booked slot.
 */
@Slf4j
@Component
public class ReservationClient {

    private final RestTemplate restTemplate;
    private final String machineStateServiceUrl;
    private final CircuitBreaker circuitBreaker;
    private final Bulkhead bulkhead;

    public ReservationClient(@Qualifier("machineStateRestTemplate") RestTemplate restTemplate,
                              @Value("${machine-state-service.base-url:http://localhost:8082}") String machineStateServiceUrl,
                              CircuitBreakerRegistry circuitBreakerRegistry,
                              BulkheadRegistry bulkheadRegistry) {
        this.restTemplate           = restTemplate;
        this.machineStateServiceUrl = machineStateServiceUrl;
        this.circuitBreaker         = circuitBreakerRegistry.circuitBreaker("machineStateService");
        this.bulkhead               = bulkheadRegistry.bulkhead("machineStateService");
    }

    /**
     * Cross-checks a reservation code against a machine before charging, so a stale,
     * mistyped, or already-used code is caught before any money moves rather than after,
     * at start-cycle time.
     *
     * @throws PaymentException {@code RESERVATION_STATUS_UNKNOWN} if MachineStateService
     *         cannot be reached.
     * @return true if the code is valid for this machine right now.
     */
    public boolean isValid(String reservationCode, String machineId) {
        String url = machineStateServiceUrl + "/api/reservations/validate";
        Map<String, Object> body = new HashMap<>();
        body.put("reservationCode", reservationCode);
        body.put("machineId", machineId);

        Supplier<Map> call = () -> restTemplate.postForObject(url, body, Map.class);
        call = Bulkhead.decorateSupplier(bulkhead, call);
        call = CircuitBreaker.decorateSupplier(circuitBreaker, call);

        try {
            Map<?, ?> response = call.get();
            return response != null && Boolean.TRUE.equals(response.get("valid"));
        } catch (Exception e) {
            log.warn("ReservationClient: could not validate code for machine {} — failing closed: {}",
                    machineId, e.getMessage());
            throw new PaymentException("RESERVATION_STATUS_UNKNOWN",
                    "Could not verify reservation code for machine " + machineId);
        }
    }

    /**
     * Checks whether a walk-in's chosen cycle duration would run into an upcoming reservation on
     * this machine (window {@code [now, now+durationMinutes)}), excluding the reservation being
     * redeemed (if {@code reservationCode} is supplied) so a legitimate redemption never
     * self-conflicts.
     *
     * @throws PaymentException {@code RESERVATION_STATUS_UNKNOWN} if MachineStateService
     *         cannot be reached.
     * @return the conflicting reservation's slot start time, or empty if there's no conflict.
     */
    public Optional<LocalDateTime> checkConflict(String machineId, int durationMinutes, String reservationCode) {
        UriComponentsBuilder builder = UriComponentsBuilder
                .fromUriString(machineStateServiceUrl + "/api/reservations/conflicts")
                .queryParam("machineId", machineId)
                .queryParam("durationMinutes", durationMinutes);
        if (StringUtils.hasText(reservationCode)) {
            builder.queryParam("reservationCode", reservationCode);
        }
        String url = builder.encode().toUriString();

        Supplier<Map> call = () -> restTemplate.getForObject(url, Map.class);
        call = Bulkhead.decorateSupplier(bulkhead, call);
        call = CircuitBreaker.decorateSupplier(circuitBreaker, call);

        try {
            Map<?, ?> response = call.get();
            if (response == null || !Boolean.TRUE.equals(response.get("conflict"))) {
                return Optional.empty();
            }
            Object slotStart = response.get("conflictingSlotStart");
            return Optional.ofNullable(slotStart).map(Object::toString).map(LocalDateTime::parse);
        } catch (Exception e) {
            log.warn("ReservationClient: could not check reservation conflicts for machine {} — failing closed: {}",
                    machineId, e.getMessage());
            throw new PaymentException("RESERVATION_STATUS_UNKNOWN",
                    "Could not verify reservation availability for machine " + machineId);
        }
    }
}
