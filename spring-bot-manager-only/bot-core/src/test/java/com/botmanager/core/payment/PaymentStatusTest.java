package com.botmanager.core.payment;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import static org.assertj.core.api.Assertions.assertThat;

class PaymentStatusTest {

    @ParameterizedTest
    @CsvSource({
            "COMPLETED, COMPLETED",
            "SUCCESSFUL, COMPLETED",
            "SUCCESS, COMPLETED",
            "PAID, COMPLETED",
            "FAILED, FAILED",
            "FAILURE, FAILED",
            "CANCELLED, FAILED",
            "REJECTED, FAILED",
            "EXPIRED, FAILED",
            "PROCESSING, PROCESSING",
            "IN_PROGRESS, PROCESSING",
            "ACCEPTED, PROCESSING",
            "PENDING, PENDING",
            "UNKNOWN, PENDING"
    })
    void shouldNormalizeStatusCorrectly(String input, String expected) {
        // when
        PaymentStatus result = PaymentStatus.fromValue(input);

        // then
        assertThat(result.getValue()).isEqualTo(expected);
    }

    @Test
    void shouldReturnPendingForNullInput() {
        // when
        PaymentStatus result = PaymentStatus.fromValue(null);

        // then
        assertThat(result).isEqualTo(PaymentStatus.PENDING);
    }

    @Test
    void shouldIdentifyTerminalStatuses() {
        // then
        assertThat(PaymentStatus.COMPLETED.isTerminal()).isTrue();
        assertThat(PaymentStatus.FAILED.isTerminal()).isTrue();
        assertThat(PaymentStatus.PENDING.isTerminal()).isFalse();
        assertThat(PaymentStatus.PROCESSING.isTerminal()).isFalse();
    }

}
