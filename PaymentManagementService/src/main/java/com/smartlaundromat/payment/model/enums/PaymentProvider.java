package com.smartlaundromat.payment.model.enums;

/**
 * Identifies which payment provider processed a transaction.
 * <p>EQLink is NOT listed here — EQLink is a machine control platform, not a payment gateway.
 * All payments go through CamPay, MTN MoMo, or Orange Money.
 *
 * <ul>
 *   <li>CAMPAY       — CamPay mobile money gateway (MTN and Orange via CamPay)</li>
 *   <li>MTN          — MTN MoMo direct integration</li>
 *   <li>ORANGE_MONEY — Orange Money direct integration</li>
 * </ul>
 */
public enum PaymentProvider {
    CAMPAY,
    MTN,
    ORANGE_MONEY
}
