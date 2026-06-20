package com.botmanager.core.payment;

import lombok.Builder;

import java.util.Map;

@Builder
public record PaymentRequest(
    String botId,
    int amount,
    String currency,
    String phoneNumber,
    String reference,
    String description,
    Map<String, Object> metadata
) {}
