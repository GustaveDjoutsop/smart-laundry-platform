package com.botmanager.core.bot;

import java.util.Locale;

import org.springframework.util.StringUtils;

public enum BotType {
    LAUNDRY("laundry"),
    THOMAS_NETWORK("thomas_network");

    private final String value;

    BotType(String value) {
        this.value = value;
    }

    public static BotType fromValue(String value) {
        if (!StringUtils.hasText(value)) {
            return null;
        }

        String normalized = value.trim().toLowerCase(Locale.ROOT);
        for (BotType type : values()) {
            if (type.value.equals(normalized)) {
                return type;
            }
        }

        return null;
    }
}