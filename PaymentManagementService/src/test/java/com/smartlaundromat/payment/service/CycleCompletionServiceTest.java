package com.smartlaundromat.payment.service;

import com.smartlaundromat.payment.config.PaymentConfig;
import com.smartlaundromat.payment.model.Transaction;
import com.smartlaundromat.payment.model.enums.PaymentProvider;
import com.smartlaundromat.payment.model.enums.PaymentStatus;
import com.smartlaundromat.payment.repository.TransactionRepository;
import com.smartlaundromat.payment.service.notification.BotNotificationClient;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class CycleCompletionServiceTest {

    @Mock
    TransactionRepository transactionRepository;

    @Mock
    PaymentConfig paymentConfig;

    @Mock
    BotNotificationClient botNotificationClient;

    @InjectMocks
    CycleCompletionService cycleCompletionService;

    private Transaction buildTransaction(LocalDateTime updatedAt, int cycleDuration) {
        return Transaction.builder()
                .externalReference("EXT-001")
                .machineId("MACH-01")
                .phoneNumber("+237600000000")
                .amount(new BigDecimal("1000"))
                .cycleDuration(cycleDuration)
                .paymentProvider(PaymentProvider.CAMPAY)
                .status(PaymentStatus.SUCCESSFUL)
                .updatedAt(updatedAt)
                .build();
    }

    @Test
    void shouldSendCompletionNotificationWhenCycleHasFinished() {
        when(paymentConfig.getReminderLookbackMinutes()).thenReturn(90);

        // 30-minute cycle, started 31 minutes ago -> already finished
        Transaction tx = buildTransaction(LocalDateTime.now().minusMinutes(31), 30);
        when(transactionRepository.findByStatusAndCompletedNotifiedAtIsNullAndUpdatedAtAfter(
                eq(PaymentStatus.SUCCESSFUL), any(LocalDateTime.class)))
                .thenReturn(List.of(tx));
        when(transactionRepository.save(any(Transaction.class))).thenAnswer(inv -> inv.getArgument(0));

        cycleCompletionService.checkCompletedCycles();

        verify(botNotificationClient).sendCycleCompleted(eq(tx), anyString());
        ArgumentCaptor<Transaction> captor = ArgumentCaptor.forClass(Transaction.class);
        verify(transactionRepository).save(captor.capture());
        assertThat(captor.getValue().getCompletedNotifiedAt()).isNotNull();
    }

    @Test
    void shouldNotSendWhenCycleStillRunning() {
        when(paymentConfig.getReminderLookbackMinutes()).thenReturn(90);

        // 30-minute cycle, started 1 minute ago -> still running
        Transaction tx = buildTransaction(LocalDateTime.now().minusMinutes(1), 30);
        when(transactionRepository.findByStatusAndCompletedNotifiedAtIsNullAndUpdatedAtAfter(
                eq(PaymentStatus.SUCCESSFUL), any(LocalDateTime.class)))
                .thenReturn(List.of(tx));

        cycleCompletionService.checkCompletedCycles();

        verifyNoInteractions(botNotificationClient);
        verify(transactionRepository, never()).save(any());
    }

    @Test
    void shouldSkipTransactionWithBlankPhoneNumber() {
        when(paymentConfig.getReminderLookbackMinutes()).thenReturn(90);

        Transaction tx = buildTransaction(LocalDateTime.now().minusMinutes(31), 30);
        tx.setPhoneNumber(" ");
        when(transactionRepository.findByStatusAndCompletedNotifiedAtIsNullAndUpdatedAtAfter(
                eq(PaymentStatus.SUCCESSFUL), any(LocalDateTime.class)))
                .thenReturn(List.of(tx));

        cycleCompletionService.checkCompletedCycles();

        verifyNoInteractions(botNotificationClient);
        verify(transactionRepository, never()).save(any());
    }

    @Test
    void shouldSkipTransactionWithNullCycleDuration() {
        when(paymentConfig.getReminderLookbackMinutes()).thenReturn(90);

        Transaction tx = buildTransaction(LocalDateTime.now().minusMinutes(31), 30);
        tx.setCycleDuration(null);
        when(transactionRepository.findByStatusAndCompletedNotifiedAtIsNullAndUpdatedAtAfter(
                eq(PaymentStatus.SUCCESSFUL), any(LocalDateTime.class)))
                .thenReturn(List.of(tx));

        cycleCompletionService.checkCompletedCycles();

        verifyNoInteractions(botNotificationClient);
        verify(transactionRepository, never()).save(any());
    }

    @Test
    void shouldLeaveCompletedNotifiedAtNullWhenNotificationFails() {
        when(paymentConfig.getReminderLookbackMinutes()).thenReturn(90);

        Transaction tx = buildTransaction(LocalDateTime.now().minusMinutes(31), 30);
        when(transactionRepository.findByStatusAndCompletedNotifiedAtIsNullAndUpdatedAtAfter(
                eq(PaymentStatus.SUCCESSFUL), any(LocalDateTime.class)))
                .thenReturn(List.of(tx));
        doThrow(new RuntimeException("bot service unavailable"))
                .when(botNotificationClient).sendCycleCompleted(eq(tx), anyString());

        cycleCompletionService.checkCompletedCycles();

        assertThat(tx.getCompletedNotifiedAt()).isNull();
        verify(transactionRepository, never()).save(any());
    }

    @Test
    void shouldNotPropagateWhenSaveFailsAfterSuccessfulSend() {
        when(paymentConfig.getReminderLookbackMinutes()).thenReturn(90);

        Transaction tx = buildTransaction(LocalDateTime.now().minusMinutes(31), 30);
        when(transactionRepository.findByStatusAndCompletedNotifiedAtIsNullAndUpdatedAtAfter(
                eq(PaymentStatus.SUCCESSFUL), any(LocalDateTime.class)))
                .thenReturn(List.of(tx));
        when(transactionRepository.save(any(Transaction.class)))
                .thenThrow(new RuntimeException("DB connection lost"));

        assertThatCode(() -> cycleCompletionService.checkCompletedCycles())
                .doesNotThrowAnyException();

        verify(botNotificationClient).sendCycleCompleted(eq(tx), anyString());
        verify(transactionRepository).save(any(Transaction.class));
    }

    @Test
    void shouldDoNothingWhenNoCandidates() {
        when(paymentConfig.getReminderLookbackMinutes()).thenReturn(90);
        when(transactionRepository.findByStatusAndCompletedNotifiedAtIsNullAndUpdatedAtAfter(
                eq(PaymentStatus.SUCCESSFUL), any(LocalDateTime.class)))
                .thenReturn(List.of());

        cycleCompletionService.checkCompletedCycles();

        verifyNoInteractions(botNotificationClient);
        verify(transactionRepository, never()).save(any());
    }
}
