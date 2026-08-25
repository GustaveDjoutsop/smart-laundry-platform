package com.smartlaundromat.contracts.payment;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;

/**
 * The {@code POST /api/payments/initiate} request body — the entry point for every
 * paid machine start (walk-in, reservation redemption) and reservation-fee hold.
 *
 * @param provider          required — the mobile money gateway to charge through.
 * @param reservationCode   set only when redeeming an active reservation; null for
 *                          ordinary walk-in payments.
 * @param reservationHold   {@code true} when this payment is the fee that
 *                          confirms/holds a future reservation slot, rather than a
 *                          payment meant to start a machine right now. Defaults to
 *                          {@code false} in every caller unless explicitly set.
 * @param idempotencyKey    optional client-generated key; a repeated request with the
 *                          same key returns the existing transaction's current state
 *                          instead of creating a duplicate payment.
 */
public record PaymentInitiateRequest(
        @NotBlank(message = "Phone number is required") String phoneNumber,
        @NotNull(message = "Amount is required")
        @Positive(message = "Amount must be positive") BigDecimal amount,
        @NotBlank(message = "Machine ID is required") String machineId,
        @NotNull(message = "Pulse count is required") Integer pulseCount,
        @NotNull(message = "Cycle duration is required") Integer cycleDuration,
        @NotNull(message = "Payment provider is required") PaymentProvider provider,
        String description,
        String reservationCode,
        boolean reservationHold,
        @Size(max = 50, message = "Idempotency key must be at most 50 characters") String idempotencyKey) {
}
