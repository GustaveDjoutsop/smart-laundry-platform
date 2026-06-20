package com.botmanager.core.queue;

import lombok.Builder;

import java.util.Map;

@Builder
public record MessageJob(
    String phoneNumberId,
    String from,
    String messageId,
    String messageBody,
    String messageType,
    Map<String, Object> raw
) {}
