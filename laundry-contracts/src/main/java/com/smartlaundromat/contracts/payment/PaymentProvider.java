package com.smartlaundromat.contracts.payment;

/**
 * Wire-level mirror of PaymentManagementService's internal
 * {@code com.smartlaundromat.payment.model.enums.PaymentProvider}. Kept as a separate
 * type (R8) so this module stays dependency-free of any service's persistence model.
 *
 * <p>EQLink is NOT listed here — EQLink is a machine control platform, not a payment
 * gateway. Only CAMPAY is an active provider; MTN and ORANGE_MONEY exist solely so
 * historical transactions still deserialize — requesting either at initiation is
 * rejected with {@code PROVIDER_DISABLED}.
 */
public enum PaymentProvider {
    CAMPAY,
    MTN,
    ORANGE_MONEY
}
