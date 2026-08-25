package com.smartlaundromat.contracts.reservation;

import java.time.LocalDateTime;

/**
 * Reservation details returned by MachineStateService's reservation endpoints
 * ({@code POST /api/reservations}, {@code /activate}, {@code /cancel}, and
 * {@code GET /api/reservations/{code}}). The {@code reservationCode} is what the bot
 * forwards to the customer's WhatsApp; the customer sends it back to run the machine.
 *
 * @param reservationCode       the customer-facing redemption code.
 * @param feeAmount             the reservation fee, in the smallest unit of
 *                              {@code currency} (e.g. XAF has no subunit, so this is
 *                              whole XAF).
 * @param transactionReference  the fee payment this reservation is attributed to.
 * @param message                human-readable status detail (e.g. why activation
 *                                failed); may be null on success.
 */
public record ReservationResponse(
        String reservationCode,
        String machineId,
        String machineName,
        String customerPhone,
        LocalDateTime slotStart,
        LocalDateTime slotEnd,
        ReservationStatus status,
        Integer feeAmount,
        String currency,
        String transactionReference,
        String message) {
}
