package com.smartlaundromat.machine.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * Request to reserve a machine for a 1-hour slot.
 *
 * <p>The slot is always exactly 1 hour: {@code slotEnd = slotStart + 1h}. The caller only
 * supplies {@code slotStart}. The reservation fee is taken from server configuration
 * (price of the highest washing cycle) and need not be supplied.
 */
@Data
public class CreateReservationRequest {

    @NotBlank(message = "Machine ID is required")
    private String machineId;

    /** Phone of whoever is making the reservation (informational; not used to authorize). */
    private String customerPhone;

    /** Start of the 1-hour slot. The end is computed as start + 1 hour. */
    @NotNull(message = "Slot start is required")
    private LocalDateTime slotStart;
}
