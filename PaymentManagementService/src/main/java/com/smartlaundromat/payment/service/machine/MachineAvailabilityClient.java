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
import org.springframework.web.client.RestTemplate;

import java.util.Map;
import java.util.function.Supplier;

/**
 * Asks MachineStateService whether a machine is currently available, via
 * {@code GET /api/machines/{machineId}}, instead of PaymentService re-deriving
 * "is it still running" from its own transaction history. MachineStateService
 * already owns the authoritative machine/cycle state (including the post-cycle
 * FINISHED grace period before a machine becomes bookable again), so this avoids
 * the two services drifting out of sync.
 *
 * <p>Fails closed: if MachineStateService can't be reached, callers should treat
 * the machine as unavailable rather than risk double-booking it.
 */
@Slf4j
@Component
public class MachineAvailabilityClient {

    private final RestTemplate restTemplate;
    private final String machineStateServiceUrl;
    private final CircuitBreaker circuitBreaker;
    private final Bulkhead bulkhead;

    public MachineAvailabilityClient(@Qualifier("machineStateRestTemplate") RestTemplate restTemplate,
                                     @Value("${machine-state-service.base-url:http://localhost:8082}") String machineStateServiceUrl,
                                     CircuitBreakerRegistry circuitBreakerRegistry,
                                     BulkheadRegistry bulkheadRegistry) {
        this.restTemplate           = restTemplate;
        this.machineStateServiceUrl = machineStateServiceUrl;
        this.circuitBreaker         = circuitBreakerRegistry.circuitBreaker("machineStateService");
        this.bulkhead               = bulkheadRegistry.bulkhead("machineStateService");
    }

    /**
     * @throws PaymentException {@code MACHINE_STATUS_UNKNOWN} if MachineStateService
     *         cannot be reached — callers should reject the payment rather than guess.
     */
    public boolean isAvailable(String machineId) {
        String url = machineStateServiceUrl + "/api/machines/" + machineId;

        Supplier<Map> call = () -> restTemplate.getForObject(url, Map.class);
        call = Bulkhead.decorateSupplier(bulkhead, call);
        call = CircuitBreaker.decorateSupplier(circuitBreaker, call);

        try {
            Map<?, ?> body = call.get();
            return body != null && Boolean.TRUE.equals(body.get("available"));
        } catch (Exception e) {
            log.warn("MachineAvailabilityClient: could not verify status of machine {} — failing closed: {}",
                    machineId, e.getMessage());
            throw new PaymentException("MACHINE_STATUS_UNKNOWN",
                    "Could not verify status of machine " + machineId);
        }
    }
}
