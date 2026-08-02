package com.smartlaundromat.payment.model.enums;

/**
 * Identifies which payment provider processed a transaction.
 * <p>EQLink is NOT listed here — EQLink is a machine control platform, not a payment gateway.
 * <p>Only CAMPAY is an active provider. MTN and ORANGE_MONEY are retained solely so
 * historical transactions still deserialize correctly — requesting either at payment
 * initiation is rejected with {@code PROVIDER_DISABLED}.
 *
 * <ul>
 *   <li>CAMPAY       — CamPay mobile money gateway (MTN and Orange via CamPay)</li>
 *   <li>MTN          — historical only, MTN MoMo direct integration removed</li>
 *   <li>ORANGE_MONEY — historical only, Orange Money direct integration removed</li>
 * </ul>
 */
public enum PaymentProvider {
    CAMPAY,
    MTN,
    ORANGE_MONEY
}
