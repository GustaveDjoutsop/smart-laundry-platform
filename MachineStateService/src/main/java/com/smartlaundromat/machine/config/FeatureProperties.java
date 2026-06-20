package com.smartlaundromat.machine.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * Feature flags for MachineStateService. All default <strong>disabled</strong>.
 *
 * <ul>
 *   <li>{@code features.reservation-enabled} — enables the machine-reservation mechanism
 *       (reservation endpoints + reserved-slot enforcement in {@code startCycle}).</li>
 * </ul>
 *
 * <p>The wash-flow feature flag (machine→cycle→payment) is enforced upstream in the bot
 * (spring-bot-manager), not here.
 */
@Data
@Component
@ConfigurationProperties(prefix = "features")
public class FeatureProperties {

    /** Enables the reservation mechanism. Default {@code false}. */
    private boolean reservationEnabled = false;
}
