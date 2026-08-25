package com.smartlaundromat.contracts.payment;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * A transaction's status, as returned by {@code GET /api/payments/transaction/{reference}}
 * and used for status polling. Deliberately a slim projection, not the full
 * PaymentManagementService {@code Transaction} JPA entity — the previous behavior of
 * returning the entity directly over the wire leaked persistence-only fields
 * ({@code id}, {@code failureReason}, {@code timeoutAt}, {@code reminderSentAt},
 * {@code updatedAt}, ...) that no caller needs and that would otherwise couple every
 * consumer to PMS's internal schema (R8).
 *
 * @param externalReference  the public transaction reference (never the internal
 *                           database id).
 * @param cycleStartedAt     set once, when the payment first succeeds and the machine
 *                           cycle begins; null while still pending.
 */
public record TransactionStatus(
        String externalReference,
        PaymentStatus status,
        String machineId,
        BigDecimal amount,
        String currency,
        PaymentProvider provider,
        String reservationCode,
        LocalDateTime createdAt,
        LocalDateTime cycleStartedAt) {
}
