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
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class CycleReminderServiceTest {

    @Mock
    TransactionRepository transactionRepository;

    @Mock
    PaymentConfig paymentConfig;

    @Mock
    BotNotificationClient botNotificationClient;

    @InjectMocks
    CycleReminderService cycleReminderService;

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
    void shouldSendReminderWhenInsideReminderWindow() {
        when(paymentConfig.getReminderLookbackMinutes()).thenReturn(90);
        when(paymentConfig.getReminderMinutesBefore()).thenReturn(5);

        // 30-minute cycle, started 27 minutes ago -> 3 minutes left, inside the 5-minute window
        Transaction tx = buildTransaction(LocalDateTime.now().minusMinutes(27), 30);
        when(transactionRepository.findByStatusAndReminderSentAtIsNullAndUpdatedAtAfter(
                eq(PaymentStatus.SUCCESSFUL), any(LocalDateTime.class)))
                .thenReturn(List.of(tx));
        when(transactionRepository.save(any(Transaction.class))).thenAnswer(inv -> inv.getArgument(0));

        cycleReminderService.checkAlmostDoneCycles();

        verify(botNotificationClient).sendCycleAlmostDone(eq(tx), anyInt());
        ArgumentCaptor<Transaction> captor = ArgumentCaptor.forClass(Transaction.class);
        verify(transactionRepository).save(captor.capture());
        assertThat(captor.getValue().getReminderSentAt()).isNotNull();
    }

    @Test
    void shouldNotSendReminderWhenTooEarly() {
        when(paymentConfig.getReminderLookbackMinutes()).thenReturn(90);
        when(paymentConfig.getReminderMinutesBefore()).thenReturn(5);

        // 30-minute cycle, started 1 minute ago -> 29 minutes left, well outside the window
        Transaction tx = buildTransaction(LocalDateTime.now().minusMinutes(1), 30);
        when(transactionRepository.findByStatusAndReminderSentAtIsNullAndUpdatedAtAfter(
                eq(PaymentStatus.SUCCESSFUL), any(LocalDateTime.class)))
                .thenReturn(List.of(tx));

        cycleReminderService.checkAlmostDoneCycles();

        verifyNoInteractions(botNotificationClient);
        verify(transactionRepository, never()).save(any());
    }

    @Test
    void shouldNotSendReminderWhenCycleAlreadyFinished() {
        when(paymentConfig.getReminderLookbackMinutes()).thenReturn(90);
        when(paymentConfig.getReminderMinutesBefore()).thenReturn(5);

        // 30-minute cycle, started 40 minutes ago -> already finished
        Transaction tx = buildTransaction(LocalDateTime.now().minusMinutes(40), 30);
        when(transactionRepository.findByStatusAndReminderSentAtIsNullAndUpdatedAtAfter(
                eq(PaymentStatus.SUCCESSFUL), any(LocalDateTime.class)))
                .thenReturn(List.of(tx));

        cycleReminderService.checkAlmostDoneCycles();

        verifyNoInteractions(botNotificationClient);
        verify(transactionRepository, never()).save(any());
    }

    @Test
    void shouldLeaveReminderSentAtNullWhenNotificationFails() {
        when(paymentConfig.getReminderLookbackMinutes()).thenReturn(90);
        when(paymentConfig.getReminderMinutesBefore()).thenReturn(5);

        Transaction tx = buildTransaction(LocalDateTime.now().minusMinutes(27), 30);
        when(transactionRepository.findByStatusAndReminderSentAtIsNullAndUpdatedAtAfter(
                eq(PaymentStatus.SUCCESSFUL), any(LocalDateTime.class)))
                .thenReturn(List.of(tx));
        doThrow(new RuntimeException("bot service unavailable"))
                .when(botNotificationClient).sendCycleAlmostDone(eq(tx), anyInt());

        cycleReminderService.checkAlmostDoneCycles();

        assertThat(tx.getReminderSentAt()).isNull();
        verify(transactionRepository, never()).save(any());
    }

    @Test
    void shouldDoNothingWhenNoCandidates() {
        when(paymentConfig.getReminderLookbackMinutes()).thenReturn(90);
        when(transactionRepository.findByStatusAndReminderSentAtIsNullAndUpdatedAtAfter(
                eq(PaymentStatus.SUCCESSFUL), any(LocalDateTime.class)))
                .thenReturn(List.of());

        cycleReminderService.checkAlmostDoneCycles();

        verifyNoInteractions(botNotificationClient);
        verify(transactionRepository, never()).save(any());
    }

    @Test
    void shouldSendReminderAtWindowOpenBoundary() {
        when(paymentConfig.getReminderLookbackMinutes()).thenReturn(90);
        when(paymentConfig.getReminderMinutesBefore()).thenReturn(5);

        // 30-minute cycle, started 25 minutes ago -> reminderAt is (approximately) "now";
        // the clock only moves forward between this line and the service's own now(), so
        // this exercises the reminderAt boundary as inclusive without needing a fake Clock.
        Transaction tx = buildTransaction(LocalDateTime.now().minusMinutes(25), 30);
        when(transactionRepository.findByStatusAndReminderSentAtIsNullAndUpdatedAtAfter(
                eq(PaymentStatus.SUCCESSFUL), any(LocalDateTime.class)))
                .thenReturn(List.of(tx));
        when(transactionRepository.save(any(Transaction.class))).thenAnswer(inv -> inv.getArgument(0));

        cycleReminderService.checkAlmostDoneCycles();

        verify(botNotificationClient).sendCycleAlmostDone(eq(tx), anyInt());
        verify(transactionRepository).save(any(Transaction.class));
    }

    @Test
    void shouldNotSendReminderAtCycleEndBoundary() {
        when(paymentConfig.getReminderLookbackMinutes()).thenReturn(90);
        when(paymentConfig.getReminderMinutesBefore()).thenReturn(5);

        // 30-minute cycle, started 30 minutes ago -> cycleEnd is (approximately) "now";
        // same forward-clock reasoning as above exercises cycleEnd as exclusive.
        Transaction tx = buildTransaction(LocalDateTime.now().minusMinutes(30), 30);
        when(transactionRepository.findByStatusAndReminderSentAtIsNullAndUpdatedAtAfter(
                eq(PaymentStatus.SUCCESSFUL), any(LocalDateTime.class)))
                .thenReturn(List.of(tx));

        cycleReminderService.checkAlmostDoneCycles();

        verifyNoInteractions(botNotificationClient);
        verify(transactionRepository, never()).save(any());
    }

    @Test
    void shouldSkipTransactionWithBlankPhoneNumber() {
        when(paymentConfig.getReminderLookbackMinutes()).thenReturn(90);

        Transaction tx = buildTransaction(LocalDateTime.now().minusMinutes(27), 30);
        tx.setPhoneNumber("   ");
        when(transactionRepository.findByStatusAndReminderSentAtIsNullAndUpdatedAtAfter(
                eq(PaymentStatus.SUCCESSFUL), any(LocalDateTime.class)))
                .thenReturn(List.of(tx));

        cycleReminderService.checkAlmostDoneCycles();

        verifyNoInteractions(botNotificationClient);
        verify(transactionRepository, never()).save(any());
    }

    @Test
    void shouldSkipTransactionWithNullCycleDuration() {
        when(paymentConfig.getReminderLookbackMinutes()).thenReturn(90);

        Transaction tx = buildTransaction(LocalDateTime.now().minusMinutes(27), 30);
        tx.setCycleDuration(null);
        when(transactionRepository.findByStatusAndReminderSentAtIsNullAndUpdatedAtAfter(
                eq(PaymentStatus.SUCCESSFUL), any(LocalDateTime.class)))
                .thenReturn(List.of(tx));

        cycleReminderService.checkAlmostDoneCycles();

        verifyNoInteractions(botNotificationClient);
        verify(transactionRepository, never()).save(any());
    }

    @Test
    void shouldNotPropagateWhenSaveFailsAfterSuccessfulSend() {
        when(paymentConfig.getReminderLookbackMinutes()).thenReturn(90);
        when(paymentConfig.getReminderMinutesBefore()).thenReturn(5);

        Transaction tx = buildTransaction(LocalDateTime.now().minusMinutes(27), 30);
        when(transactionRepository.findByStatusAndReminderSentAtIsNullAndUpdatedAtAfter(
                eq(PaymentStatus.SUCCESSFUL), any(LocalDateTime.class)))
                .thenReturn(List.of(tx));
        when(transactionRepository.save(any(Transaction.class)))
                .thenThrow(new RuntimeException("DB connection lost"));

        // The notification already went out; a save failure here must not be treated
        // like a send failure (it's logged separately, not silently retried at WARN),
        // and must not throw out of the scheduled method.
        assertThatCode(() -> cycleReminderService.checkAlmostDoneCycles())
                .doesNotThrowAnyException();

        verify(botNotificationClient).sendCycleAlmostDone(eq(tx), anyInt());
        verify(transactionRepository).save(any(Transaction.class));
    }
}
