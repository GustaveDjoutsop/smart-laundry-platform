package com.smartlaundromat.machine.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

/**
 * Cross-checks a reservation code against a machine before the machine is made available.
 *
 * <p><strong>Authorization is by code + machine only</strong> — there is intentionally no
 * customer/user field, because a reservation may have been made on someone else's behalf.
 */
@Data
public class ValidateReservationRequest {

    @NotBlank(message = "Reservation code is required")
    private String reservationCode;

    @NotBlank(message = "Machine ID is required")
    private String machineId;
}
