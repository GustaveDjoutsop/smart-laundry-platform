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

    private Transaction buildTransaction(LocalDateTime cycleStartedAt, int cycleDuration) {
        return Transaction.builder()
                .externalReference("EXT-001")
                .machineId("MACH-01")
                .phoneNumber("+237600000000")
                .amount(new BigDecimal("1000"))
                .cycleDuration(cycleDuration)
                .paymentProvider(PaymentProvider.CAMPAY)
                .status(PaymentStatus.SUCCESSFUL)
                .cycleStartedAt(cycleStartedAt)
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
    void shouldSkipTransactionWithNullCycleStartedAt() {
        when(paymentConfig.getReminderLookbackMinutes()).thenReturn(90);

        Transaction tx = buildTransaction(LocalDateTime.now().minusMinutes(31), 30);
        tx.setCycleStartedAt(null);
        when(transactionRepository.findByStatusAndCompletedNotifiedAtIsNullAndUpdatedAtAfter(
                eq(PaymentStatus.SUCCESSFUL), any(LocalDateTime.class)))
                .thenReturn(List.of(tx));

        cycleCompletionService.checkCompletedCycles();

        verifyNoInteractions(botNotificationClient);
        verify(transactionRepository, never()).save(any());
    }

    @Test
    void shouldComputeCycleEndFromCycleStartedAtNotUpdatedAt() {
        when(paymentConfig.getReminderLookbackMinutes()).thenReturn(90);

        // cycleStartedAt says 31 minutes ago (already finished), but updatedAt (as if
        // refreshed by CycleReminderService's own @PreUpdate-triggering save on an
        // earlier poll) says only 1 minute ago. If timing math incorrectly used
        // updatedAt instead of cycleStartedAt, this would look like still running
        // and no completion notification would be sent.
        Transaction tx = buildTransaction(LocalDateTime.now().minusMinutes(31), 30);
        tx.setUpdatedAt(LocalDateTime.now().minusMinutes(1));
        when(transactionRepository.findByStatusAndCompletedNotifiedAtIsNullAndUpdatedAtAfter(
                eq(PaymentStatus.SUCCESSFUL), any(LocalDateTime.class)))
                .thenReturn(List.of(tx));
        when(transactionRepository.save(any(Transaction.class))).thenAnswer(inv -> inv.getArgument(0));

        cycleCompletionService.checkCompletedCycles();

        verify(botNotificationClient).sendCycleCompleted(eq(tx), anyString());
    }

    @Test
    void shouldFormatEndTimeInDoualaTimezone() {
        when(paymentConfig.getReminderLookbackMinutes()).thenReturn(90);

        // Fixed cycleStartedAt far in the past so cycleEnd is unambiguously finished
        // regardless of when this test runs. cycleEnd = 2026-01-01T12:30:00 (treated
        // as UTC) -> Africa/Douala is UTC+1 year-round (WAT, no DST) -> 13:30.
        Transaction tx = buildTransaction(LocalDateTime.of(2026, 1, 1, 12, 0), 30);
        when(transactionRepository.findByStatusAndCompletedNotifiedAtIsNullAndUpdatedAtAfter(
                eq(PaymentStatus.SUCCESSFUL), any(LocalDateTime.class)))
                .thenReturn(List.of(tx));
        when(transactionRepository.save(any(Transaction.class))).thenAnswer(inv -> inv.getArgument(0));

        cycleCompletionService.checkCompletedCycles();

        verify(botNotificationClient).sendCycleCompleted(tx, "13:30");
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
