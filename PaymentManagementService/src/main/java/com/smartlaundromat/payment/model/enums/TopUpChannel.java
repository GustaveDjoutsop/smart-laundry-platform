package com.smartlaundromat.payment.model.enums;

/**
 * Identifies how an RFID card top-up was paid for.
 * <p>Only CAMPAY and CASH are active. MTN and ORANGE_MONEY are retained solely so
 * historical top-ups still deserialize correctly — requesting either is rejected with
 * {@code PROVIDER_DISABLED}.
 */
public enum TopUpChannel {
    CAMPAY,
    MTN,
    ORANGE_MONEY,
    CASH
}
