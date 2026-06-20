package com.smartlaundromat.machine.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

/**
 * Activates a reservation once its reservation-fee payment is confirmed.
 * Called by PaymentManagementService after a successful reservation-fee payment.
 */
@Data
public class ActivateReservationRequest {

    /** The payment reference returned when the reservation was created. */
    @NotBlank(message = "Transaction reference is required")
    private String transactionReference;
}
