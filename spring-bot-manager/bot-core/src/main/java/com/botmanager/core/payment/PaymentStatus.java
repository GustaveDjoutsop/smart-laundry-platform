package com.botmanager.core.payment;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;
import lombok.Getter;

@Getter
public enum PaymentStatus {

    PENDING("PENDING"),
    PROCESSING("PROCESSING"),
    COMPLETED("COMPLETED"),
    FAILED("FAILED");

    private final String value;

    PaymentStatus(String value) {
        this.value = value;
    }

    @JsonValue
    public String getValue() {
        return value;
    }

    @JsonCreator
    public static PaymentStatus fromValue(String value) {
        if (value == null) {
            return PENDING;
        }

        String normalized = value.toUpperCase().trim();

        return switch (normalized) {
            case "COMPLETED", "SUCCESSFUL", "SUCCESS", "PAID" -> COMPLETED;
            case "FAILED", "FAILURE", "CANCELLED", "REJECTED", "EXPIRED" -> FAILED;
            case "PROCESSING", "IN_PROGRESS", "ACCEPTED" -> PROCESSING;
            default -> PENDING;
        };
    }

    public boolean isTerminal() {
        return this == COMPLETED || this == FAILED;
    }

}
