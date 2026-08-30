package com.smartlaundromat.payment.service;

import com.smartlaundromat.payment.model.Transaction;
import com.smartlaundromat.payment.model.enums.PaymentProvider;
import com.smartlaundromat.payment.model.enums.PaymentStatus;
import com.smartlaundromat.payment.repository.TransactionRepository;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class PayToStartReconciliationServiceTest {

    @Mock
    TransactionRepository transactionRepository;

    PayToStartReconciliationService reconciliationService;

    @BeforeEach
    void setUp() {
        reconciliationService = new PayToStartReconciliationService(transactionRepository, new SimpleMeterRegistry());
    }

    @Test
    void shouldReportZeroWhenNoOrphanedTransactionsFound() {
        // given
        when(transactionRepository.findPaidWithoutConfirmedMachineStart(any(LocalDateTime.class)))
                .thenReturn(List.of());

        // when
        reconciliationService.reconcile();

        // then
        verify(transactionRepository).findPaidWithoutConfirmedMachineStart(any(LocalDateTime.class));
    }

    @Test
    void shouldQueryWithCutoffOlderThanGracePeriod() {
        // given
        ArgumentCaptor<LocalDateTime> cutoffCaptor = ArgumentCaptor.forClass(LocalDateTime.class);
        when(transactionRepository.findPaidWithoutConfirmedMachineStart(cutoffCaptor.capture()))
                .thenReturn(List.of());

        // when
        reconciliationService.reconcile();

        // then
        LocalDateTime expectedCutoff = LocalDateTime.now()
                .minusMinutes(PayToStartReconciliationService.GRACE_PERIOD_MINUTES);
        assertThat(cutoffCaptor.getValue()).isBeforeOrEqualTo(expectedCutoff.plusSeconds(1));
    }

    @Test
    void shouldNotThrowWhenOrphanedTransactionsAreFound() {
        // given
        Transaction orphan = Transaction.builder()
                .externalReference("EXT-STUCK-001")
                .machineId("MACH-01")
                .status(PaymentStatus.SUCCESSFUL)
                .paymentProvider(PaymentProvider.CAMPAY)
                .pulseCount(1)
                .cycleDuration(30)
                .build();

        when(transactionRepository.findPaidWithoutConfirmedMachineStart(any(LocalDateTime.class)))
                .thenReturn(List.of(orphan));

        // when / then
        reconciliationService.reconcile();
    }
}
