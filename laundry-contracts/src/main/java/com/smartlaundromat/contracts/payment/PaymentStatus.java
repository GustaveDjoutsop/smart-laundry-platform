package com.smartlaundromat.contracts.payment;

/**
 * Wire-level mirror of PaymentManagementService's internal
 * {@code com.smartlaundromat.payment.model.enums.PaymentStatus}. Kept as a separate
 * type (R8) so this module stays dependency-free of any service's persistence model.
 */
public enum PaymentStatus {
    PENDING,
    SUCCESSFUL,
    FAILED,
    TIMEOUT
}
