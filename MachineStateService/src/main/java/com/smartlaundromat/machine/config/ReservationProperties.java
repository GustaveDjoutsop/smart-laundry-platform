package com.smartlaundromat.machine.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * Configuration for the reservation mechanism.
 *
 * <h2>Business rules</h2>
 * <ul>
 *   <li><strong>Slot length is fixed at exactly 1 hour</strong> — not less, not more.
 *       It is intentionally not configurable.</li>
 *   <li>The reservation fee equals the price of the <strong>highest washing cycle</strong>.
 *       Set {@code reservation.fee-amount} to that value (kept in sync with the bot's
 *       long-cycle price). The reservation fee is separate from the normal wash price the
 *       user still pays to run a cycle.</li>
 * </ul>
 */
@Data
@Component
@ConfigurationProperties(prefix = "reservation")
public class ReservationProperties {

    /** Fixed reservation slot length in minutes. Always 60 — exposed as a constant only. */
    public static final int SLOT_MINUTES = 60;

    /**
     * Reservation fee — must equal the price of the highest washing cycle.
     * Charged in addition to the normal wash price.
     */
    private int feeAmount = 1500;

    /** Currency of the reservation fee. */
    private String currency = "XAF";

    /** Number of characters in the generated reservation code (excluding the prefix). */
    private int codeLength = 6;

    /** Prefix prepended to every reservation code (e.g. {@code RES-AB12CD}). */
    private String codePrefix = "RES-";
}
