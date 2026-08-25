package com.smartlaundromat.contracts.reservation;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.LocalDateTime;

/**
 * The {@code POST /api/reservations} request body — reserves a machine for a 1-hour
 * slot. The slot is always exactly 1 hour ({@code slotEnd = slotStart + 1h}); the caller
 * only supplies {@code slotStart}. The reservation fee is taken from server
 * configuration and need not be supplied.
 *
 * @param machineId      required — the machine to reserve.
 * @param customerPhone  informational only; not used to authorize the reservation.
 * @param slotStart      required — start of the 1-hour slot.
 */
public record ReservationRequest(
        @NotBlank(message = "Machine ID is required") String machineId,
        String customerPhone,
        @NotNull(message = "Slot start is required") LocalDateTime slotStart) {
}
