package com.smartlaundromat.payment.model;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;

class RfidCardTest {

    @ParameterizedTest
    @CsvSource({
            "5000, 3000, true",
            "5000, 5000, true",
            "5000, 5001, false",
            "0,    1,    false",
    })
    void shouldCheckSufficientBalanceWhenCardIsActive(String balance, String amount, boolean expected) {
        // given
        RfidCard card = RfidCard.builder()
                .balance(new BigDecimal(balance))
                .isActive(true)
                .build();

        // when
        boolean result = card.hasSufficientBalance(new BigDecimal(amount));

        // then
        assertThat(result).isEqualTo(expected);
    }

    @Test
    void shouldReturnFalseWhenCardIsInactive() {
        // given
        RfidCard card = RfidCard.builder()
                .balance(new BigDecimal("9999"))
                .isActive(false)
                .build();

        // when
        boolean result = card.hasSufficientBalance(new BigDecimal("1"));

        // then
        assertThat(result).isFalse();
    }

    @Test
    void shouldHaveDefaultValues() {
        // given
        RfidCard card = RfidCard.builder().cardUid("TEST").build();

        // then
        assertThat(card.getBalance()).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(card.getCurrency()).isEqualTo("XAF");
        assertThat(card.getIsActive()).isTrue();
        assertThat(card.getCreatedAt()).isNotNull();
        assertThat(card.getUpdatedAt()).isNotNull();
    }
}
