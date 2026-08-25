package com.smartlaundromat.contracts.machine;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/**
 * The {@code POST /api/machines/start-cycle} request body, shared by every caller of
 * MachineStateService's start-cycle endpoint (R8) — today PaymentManagementService's
 * {@code MachineStartService} (outbox relay, post-payment) and
 * spring-bot-manager-only's {@code MachineService} (direct start), both of which
 * previously hand-built this as an untyped {@code Map<String, Object>}.
 *
 * @param machineId             required — the target machine.
 * @param cycleType             required — e.g. {@code "NORMAL"}, {@code "HEAVY"}.
 * @param durationMinutes       required — wash/dry duration.
 * @param pulseCount            required — coin-pulse count sent to the machine controller.
 * @param transactionReference  the payment transaction this start is attributed to.
 * @param reservationCode       set only when the machine is currently held by an active
 *                              reservation and the reservation feature is enabled.
 * @param rfidCardUid           set only for RFID-card-initiated starts.
 */
public record MachineStartRequest(
        @NotBlank(message = "Machine ID is required") String machineId,
        @NotBlank(message = "Cycle type is required") String cycleType,
        @NotNull(message = "Duration is required") Integer durationMinutes,
        @NotNull(message = "Pulse count is required") Integer pulseCount,
        String transactionReference,
        String reservationCode,
        String rfidCardUid) {
}
