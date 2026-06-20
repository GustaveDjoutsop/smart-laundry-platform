package com.botmanager.core.payment;

import lombok.Builder;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.util.Map;

@Getter
@Setter
@Builder
public class PaymentRecord {

    private String botId;

    private String provider;

    private String transactionId;

    private String externalRef;

    private String customerPhone;

    private int amount;

    private String currency;

    private PaymentStatus status;

    private Map<String, Object> metadata;

    private Instant createdAt;

    private Instant updatedAt;

    private Map<String, Object> raw;

}
