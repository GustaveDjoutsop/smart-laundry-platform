package com.smartlaundromat.payment.model;

import com.smartlaundromat.payment.model.enums.PaymentProvider;
import com.smartlaundromat.payment.model.enums.PaymentStatus;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;

class TransactionTest {

    @Test
    void shouldHaveDefaultValues() {
        // given
        Transaction tx = Transaction.builder()
                .amount(new BigDecimal("1000"))
                .machineId("MACH-01")
                .pulseCount(1)
                .cycleDuration(30)
                .paymentProvider(PaymentProvider.CAMPAY)
                .build();

        // then
        assertThat(tx.getExternalReference()).isNotNull();
        assertThat(tx.getCurrency()).isEqualTo("XAF");
        assertThat(tx.getStatus()).isEqualTo(PaymentStatus.PENDING);
        assertThat(tx.getCreatedAt()).isNotNull();
        assertThat(tx.getUpdatedAt()).isNotNull();
    }

    @Test
    void shouldAllowAllFieldsToBeSet() {
        // given
        Transaction tx = Transaction.builder()
                .id(1L)
                .externalReference("EXT-001")
                .amount(new BigDecimal("2000"))
                .machineId("MACH-02")
                .pulseCount(3)
                .cycleDuration(60)
                .description("Long cycle")
                .status(PaymentStatus.SUCCESSFUL)
                .paymentProvider(PaymentProvider.MTN)
                .providerReference("MTN-001")
                .rfidCardUid("ABC123")
                .phoneNumber("237612345678")
                .build();

        // then
        assertThat(tx.getId()).isEqualTo(1L);
        assertThat(tx.getAmount()).isEqualByComparingTo("2000");
        assertThat(tx.getDescription()).isEqualTo("Long cycle");
        assertThat(tx.getProviderReference()).isEqualTo("MTN-001");
        assertThat(tx.getRfidCardUid()).isEqualTo("ABC123");
    }
}
