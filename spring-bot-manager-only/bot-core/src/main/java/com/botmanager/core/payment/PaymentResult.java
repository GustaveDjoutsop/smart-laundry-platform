package com.botmanager.core.payment;

import lombok.Builder;

import java.util.Map;

@Builder
public record PaymentResult(
    boolean success,
    String transactionId,
    String externalRef,
    PaymentStatus status,
    String errorMessage,
    Map<String, Object> raw
) {}
