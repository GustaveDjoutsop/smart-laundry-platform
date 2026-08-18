package com.botmanager.util;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class LogRedactorTest {

    @Test
    void shouldReturnNullForNullInput() {
        // when
        String result = LogRedactor.redact(null);

        // then
        assertThat(result).isNull();
    }

    @Test
    void shouldRedactBearerToken() {
        // given
        String input = "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9";

        // when
        String result = LogRedactor.redact(input);

        // then
        assertThat(result).isEqualTo("Authorization: Bearer [REDACTED]");
    }

    @Test
    void shouldRedactSecretParameters() {
        // given
        String input = "password=mySecret123&user=admin";

        // when
        String result = LogRedactor.redact(input);

        // then
        assertThat(result).contains("password=[REDACTED]");
        assertThat(result).doesNotContain("mySecret123");
    }

    @Test
    void shouldRedactTokenParameters() {
        // given
        String input = "token=abc123def&action=verify";

        // when
        String result = LogRedactor.redact(input);

        // then
        assertThat(result).contains("token=[REDACTED]");
        assertThat(result).doesNotContain("abc123def");
    }

    @Test
    void shouldRedactKeyParameters() {
        // given
        String input = "key=superSecretKey&mode=production";

        // when
        String result = LogRedactor.redact(input);

        // then
        assertThat(result).contains("key=[REDACTED]");
        assertThat(result).doesNotContain("superSecretKey");
    }

    @Test
    void shouldRedactPhoneNumbers() {
        // given
        String input = "Calling +237690123456 for verification";

        // when
        String result = LogRedactor.redact(input);

        // then
        assertThat(result).contains("[PHONE]");
        assertThat(result).doesNotContain("+237690123456");
    }

    @Test
    void shouldRedactMultiplePatternsInSameInput() {
        // given
        String input = "Bearer token123 calling +237690123456 with secret=abc";

        // when
        String result = LogRedactor.redact(input);

        // then
        assertThat(result).contains("Bearer [REDACTED]");
        assertThat(result).contains("[PHONE]");
        assertThat(result).contains("secret=[REDACTED]");
    }

    @Test
    void shouldNotModifyInputWithoutSensitiveData() {
        // given
        String input = "Processing order for item XYZ";

        // when
        String result = LogRedactor.redact(input);

        // then
        assertThat(result).isEqualTo("Processing order for item XYZ");
    }

    @Test
    void shouldRedactCaseInsensitiveSecretParams() {
        // given
        String input = "Password=secret123&Token=abc";

        // when
        String result = LogRedactor.redact(input);

        // then
        assertThat(result).doesNotContain("secret123");
        assertThat(result).doesNotContain("abc");
    }

}
