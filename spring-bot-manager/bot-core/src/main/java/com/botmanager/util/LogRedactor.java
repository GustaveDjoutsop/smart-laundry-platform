package com.botmanager.util;

import java.util.regex.Pattern;

public final class LogRedactor {

    private static final Pattern BEARER_TOKEN_PATTERN = Pattern.compile("Bearer\\s+[A-Za-z0-9\\-_=]+");

    private static final Pattern SECRET_PATTERN = Pattern.compile("(password|secret|token|key)=[^&\\s]+", Pattern.CASE_INSENSITIVE);

    private static final Pattern PHONE_PATTERN = Pattern.compile("\\+?[0-9]{10,15}");

    private LogRedactor() {
    }

    public static String redact(String input) {
        if (input == null) {
            return null;
        }

        String result = BEARER_TOKEN_PATTERN.matcher(input).replaceAll("Bearer [REDACTED]");
        result = SECRET_PATTERN.matcher(result).replaceAll("$1=[REDACTED]");
        result = PHONE_PATTERN.matcher(result).replaceAll("[PHONE]");

        return result;
    }

}
