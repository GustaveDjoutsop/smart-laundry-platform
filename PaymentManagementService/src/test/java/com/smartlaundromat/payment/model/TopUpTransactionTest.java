package com.smartlaundromat.payment.model;

import com.smartlaundromat.payment.model.enums.PaymentStatus;
import com.smartlaundromat.payment.model.enums.TopUpChannel;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;

class TopUpTransactionTest {

    @Test
    void shouldHaveDefaultValues() {
        // given
        TopUpTransaction topUp = TopUpTransaction.builder()
                .rfidCardUid("ABC123")
                .amount(new BigDecimal("1000"))
                .channel(TopUpChannel.CASH)
                .build();

        // then
        assertThat(topUp.getReference()).isNotNull();
        assertThat(topUp.getCurrency()).isEqualTo("XAF");
        assertThat(topUp.getStatus()).isEqualTo(PaymentStatus.PENDING);
        assertThat(topUp.getCreatedAt()).isNotNull();
    }

    @Test
    void shouldAllowAllFieldsToBeSet() {
        // given
        TopUpTransaction topUp = TopUpTransaction.builder()
                .id(1L)
                .reference("REF-001")
                .rfidCardUid("ABC123")
                .amount(new BigDecimal("5000"))
                .phoneNumber("237612345678")
                .channel(TopUpChannel.CAMPAY)
                .status(PaymentStatus.SUCCESSFUL)
                .providerReference("CAMP-001")
                .failureReason(null)
                .build();

        // then
        assertThat(topUp.getId()).isEqualTo(1L);
        assertThat(topUp.getReference()).isEqualTo("REF-001");
        assertThat(topUp.getPhoneNumber()).isEqualTo("237612345678");
        assertThat(topUp.getProviderReference()).isEqualTo("CAMP-001");
    }
}
