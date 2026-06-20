package com.smartlaundromat.payment.service;

import com.smartlaundromat.payment.config.PaymentConfig;
import com.smartlaundromat.payment.model.Transaction;
import com.smartlaundromat.payment.model.enums.PaymentStatus;
import com.smartlaundromat.payment.repository.TransactionRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.util.Collections;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class PaymentTimeoutServiceTest {

    @Mock
    TransactionRepository transactionRepository;

    @Mock
    PaymentConfig paymentConfig;

    @InjectMocks
    PaymentTimeoutService paymentTimeoutService;

    @Test
    void shouldMarkPendingTransactionsAsTimedOut() {
        // given
        when(paymentConfig.getTimeoutMinutes()).thenReturn(5);

        Transaction tx = Transaction.builder()
                .externalReference("EXT-001")
                .machineId("MACH-01")
                .status(PaymentStatus.PENDING)
                .build();
        when(transactionRepository.findByStatusAndCreatedAtBefore(eq(PaymentStatus.PENDING), any(LocalDateTime.class)))
                .thenReturn(List.of(tx));
        when(transactionRepository.save(any(Transaction.class))).thenAnswer(inv -> inv.getArgument(0));

        // when
        paymentTimeoutService.checkTimeouts();

        // then
        ArgumentCaptor<Transaction> captor = ArgumentCaptor.forClass(Transaction.class);
        verify(transactionRepository).save(captor.capture());
        assertThat(captor.getValue().getStatus()).isEqualTo(PaymentStatus.TIMEOUT);
        assertThat(captor.getValue().getTimeoutAt()).isNotNull();
    }

    @Test
    void shouldDoNothingWhenNoPendingTransactions() {
        // given
        when(paymentConfig.getTimeoutMinutes()).thenReturn(5);
        when(transactionRepository.findByStatusAndCreatedAtBefore(eq(PaymentStatus.PENDING), any(LocalDateTime.class)))
                .thenReturn(Collections.emptyList());

        // when
        paymentTimeoutService.checkTimeouts();

        // then
        verify(transactionRepository, never()).save(any());
    }

    @Test
    void shouldMarkMultipleTransactionsAsTimedOut() {
        // given
        when(paymentConfig.getTimeoutMinutes()).thenReturn(5);

        Transaction tx1 = Transaction.builder().externalReference("EXT-001").machineId("MACH-01").status(PaymentStatus.PENDING).build();
        Transaction tx2 = Transaction.builder().externalReference("EXT-002").machineId("MACH-02").status(PaymentStatus.PENDING).build();

        when(transactionRepository.findByStatusAndCreatedAtBefore(eq(PaymentStatus.PENDING), any(LocalDateTime.class)))
                .thenReturn(List.of(tx1, tx2));
        when(transactionRepository.save(any(Transaction.class))).thenAnswer(inv -> inv.getArgument(0));

        // when
        paymentTimeoutService.checkTimeouts();

        // then
        verify(transactionRepository, times(2)).save(any(Transaction.class));
    }
}
