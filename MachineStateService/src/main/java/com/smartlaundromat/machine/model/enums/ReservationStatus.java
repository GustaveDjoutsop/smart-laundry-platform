package com.smartlaundromat.machine.model.enums;

/**
 * Lifecycle of a machine reservation.
 *
 * <pre>
 *   PENDING_PAYMENT ──(payment confirmed)──▶ ACTIVE ──(code redeemed)──▶ USED
 *         │                                     │
 *         │(payment never confirmed /           │(slot end passes
 *         │ cancelled)                          │ without redemption)
 *         ▼                                     ▼
 *     CANCELLED                              EXPIRED
 * </pre>
 */
public enum ReservationStatus {
    /** Reservation created; awaiting confirmation of the reservation-fee payment. */
    PENDING_PAYMENT,
    /** Payment confirmed; the machine is held for this reservation during its slot. */
    ACTIVE,
    /** The reservation code was redeemed to run the machine. */
    USED,
    /** The 1-hour slot ended without the code being redeemed. */
    EXPIRED,
    /** Cancelled before activation (e.g. payment failed / user cancelled). */
    CANCELLED
}
