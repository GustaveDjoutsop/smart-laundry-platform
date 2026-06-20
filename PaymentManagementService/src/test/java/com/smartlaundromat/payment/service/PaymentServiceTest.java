package com.smartlaundromat.payment.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.smartlaundromat.payment.dto.PaymentInitiationRequest;
import com.smartlaundromat.payment.dto.PaymentResponse;
import com.smartlaundromat.payment.exception.PaymentException;
import com.smartlaundromat.payment.model.OutboxEvent;
import com.smartlaundromat.payment.model.Transaction;
import com.smartlaundromat.payment.model.enums.PaymentProvider;
import com.smartlaundromat.payment.model.enums.PaymentStatus;
import com.smartlaundromat.payment.repository.OutboxEventRepository;
import com.smartlaundromat.payment.repository.TransactionRepository;
import com.smartlaundromat.payment.service.provider.CampayService;
import com.smartlaundromat.payment.service.provider.MtnMomoService;
import com.smartlaundromat.payment.service.provider.OrangeMoneyService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class PaymentServiceTest {

    @Mock
    TransactionRepository transactionRepository;

    @Mock
    OutboxEventRepository outboxEventRepository;

    @Spy
    ObjectMapper objectMapper;

    @Mock
    CampayService campayService;

    @Mock
    MtnMomoService mtnMomoService;

    @Mock
    OrangeMoneyService orangeMoneyService;

    @InjectMocks
    PaymentService paymentService;

    private PaymentInitiationRequest request;

    @BeforeEach
    void setUp() {
        request = new PaymentInitiationRequest();
        request.setPhoneNumber("237612345678");
        request.setAmount(new BigDecimal("1000"));
        request.setMachineId("MACH-01");
        request.setPulseCount(2);
        request.setCycleDuration(30);
        request.setProvider(PaymentProvider.CAMPAY);
        request.setDescription("Wash cycle");
    }

    // ── initiatePayment ──────────────────────────────────────────────────────

    @Nested
    class InitiatePayment {

        @Test
        void shouldInitiatePaymentWhenMachineIsFree() {
            when(transactionRepository.findByMachineIdAndStatus("MACH-01", PaymentStatus.SUCCESSFUL))
                    .thenReturn(Collections.emptyList());
            when(transactionRepository.findByMachineIdAndStatus("MACH-01", PaymentStatus.PENDING))
                    .thenReturn(Collections.emptyList());
            when(transactionRepository.save(any(Transaction.class))).thenAnswer(inv -> inv.getArgument(0));

            PaymentResponse providerResponse = PaymentResponse.builder()
                    .success(true)
                    .providerReference("CAMP-REF-001")
                    .build();
            when(campayService.requestPayment(anyString(), any(), anyString(), anyString()))
                    .thenReturn(providerResponse);

            PaymentResponse result = paymentService.initiatePayment(request);

            assertThat(result.getProviderReference()).isEqualTo("CAMP-REF-001");
            verify(transactionRepository, times(2)).save(any(Transaction.class));
        }

        @Test
        void shouldThrowWhenMachineHasActiveCycle() {
            Transaction active = Transaction.builder()
                    .machineId("MACH-01")
                    .status(PaymentStatus.SUCCESSFUL)
                    .build();
            when(transactionRepository.findByMachineIdAndStatus("MACH-01", PaymentStatus.SUCCESSFUL))
                    .thenReturn(List.of(active));

            assertThatThrownBy(() -> paymentService.initiatePayment(request))
                    .isInstanceOf(PaymentException.class)
                    .hasMessageContaining("active cycle");
        }

        @Test
        void shouldThrowWhenMachineHasPendingPayment() {
            when(transactionRepository.findByMachineIdAndStatus("MACH-01", PaymentStatus.SUCCESSFUL))
                    .thenReturn(Collections.emptyList());
            Transaction pending = Transaction.builder()
                    .machineId("MACH-01")
                    .status(PaymentStatus.PENDING)
                    .build();
            when(transactionRepository.findByMachineIdAndStatus("MACH-01", PaymentStatus.PENDING))
                    .thenReturn(List.of(pending));

            assertThatThrownBy(() -> paymentService.initiatePayment(request))
                    .isInstanceOf(PaymentException.class)
                    .hasMessageContaining("pending payment");
        }

        @Test
        void shouldUseMtnProviderWhenRequested() {
            request.setProvider(PaymentProvider.MTN);
            when(transactionRepository.findByMachineIdAndStatus(anyString(), eq(PaymentStatus.SUCCESSFUL)))
                    .thenReturn(Collections.emptyList());
            when(transactionRepository.findByMachineIdAndStatus(anyString(), eq(PaymentStatus.PENDING)))
                    .thenReturn(Collections.emptyList());
            when(transactionRepository.save(any(Transaction.class))).thenAnswer(inv -> inv.getArgument(0));

            PaymentResponse providerResponse = PaymentResponse.builder()
                    .success(true)
                    .providerReference("MTN-REF-001")
                    .build();
            when(mtnMomoService.requestPayment(anyString(), any(), anyString(), anyString()))
                    .thenReturn(providerResponse);

            PaymentResponse result = paymentService.initiatePayment(request);

            assertThat(result.getProviderReference()).isEqualTo("MTN-REF-001");
            verify(mtnMomoService).requestPayment(anyString(), any(), anyString(), anyString());
        }

        @Test
        void shouldUseOrangeProviderWhenRequested() {
            request.setProvider(PaymentProvider.ORANGE_MONEY);
            when(transactionRepository.findByMachineIdAndStatus(anyString(), eq(PaymentStatus.SUCCESSFUL)))
                    .thenReturn(Collections.emptyList());
            when(transactionRepository.findByMachineIdAndStatus(anyString(), eq(PaymentStatus.PENDING)))
                    .thenReturn(Collections.emptyList());
            when(transactionRepository.save(any(Transaction.class))).thenAnswer(inv -> inv.getArgument(0));

            PaymentResponse providerResponse = PaymentResponse.builder()
                    .success(true)
                    .providerReference("ORANGE-REF-001")
                    .build();
            when(orangeMoneyService.requestPayment(anyString(), any(), anyString(), anyString()))
                    .thenReturn(providerResponse);

            paymentService.initiatePayment(request);

            verify(orangeMoneyService).requestPayment(anyString(), any(), anyString(), anyString());
        }
    }

    // ── processWebhook ───────────────────────────────────────────────────────

    @Nested
    class ProcessWebhook {

        @Test
        void shouldMarkTransactionSuccessfulAndWriteOutboxEvent() {
            Transaction transaction = Transaction.builder()
                    .externalReference("EXT-001")
                    .machineId("MACH-01")
                    .pulseCount(2)
                    .cycleDuration(30)
                    .status(PaymentStatus.PENDING)
                    .build();
            when(transactionRepository.findByExternalReference("EXT-001"))
                    .thenReturn(Optional.of(transaction));
            when(transactionRepository.save(any(Transaction.class))).thenAnswer(inv -> inv.getArgument(0));
            when(outboxEventRepository.save(any(OutboxEvent.class))).thenAnswer(inv -> inv.getArgument(0));

            Transaction result = paymentService.processWebhook(
                    PaymentProvider.CAMPAY, "EXT-001", "SUCCESSFUL", "PROV-001", null);

            assertThat(result.getStatus()).isEqualTo(PaymentStatus.SUCCESSFUL);
            assertThat(result.getProviderReference()).isEqualTo("PROV-001");
            verify(outboxEventRepository).save(argThat(event ->
                    "PaymentSucceeded".equals(event.getEventType())
                    && "EXT-001".equals(event.getAggregateId())
                    && event.getPayload().contains("MACH-01")
            ));
        }

        @Test
        void shouldMarkTransactionFailedWithNoOutboxWrite() {
            Transaction transaction = Transaction.builder()
                    .externalReference("EXT-001")
                    .status(PaymentStatus.PENDING)
                    .build();
            when(transactionRepository.findByExternalReference("EXT-001"))
                    .thenReturn(Optional.of(transaction));
            when(transactionRepository.save(any(Transaction.class))).thenAnswer(inv -> inv.getArgument(0));

            Transaction result = paymentService.processWebhook(
                    PaymentProvider.CAMPAY, "EXT-001", "FAILED", null, "Insufficient funds");

            assertThat(result.getStatus()).isEqualTo(PaymentStatus.FAILED);
            assertThat(result.getFailureReason()).isEqualTo("Insufficient funds");
            verify(outboxEventRepository, never()).save(any());
        }

        @Test
        void shouldSkipAlreadySuccessfulTransaction() {
            Transaction transaction = Transaction.builder()
                    .externalReference("EXT-001")
                    .status(PaymentStatus.SUCCESSFUL)
                    .build();
            when(transactionRepository.findByExternalReference("EXT-001"))
                    .thenReturn(Optional.of(transaction));

            Transaction result = paymentService.processWebhook(
                    PaymentProvider.CAMPAY, "EXT-001", "SUCCESSFUL", "PROV-001", null);

            assertThat(result.getStatus()).isEqualTo(PaymentStatus.SUCCESSFUL);
            verify(transactionRepository, never()).save(any());
            verify(outboxEventRepository, never()).save(any());
        }

        @Test
        void shouldThrowWhenTransactionNotFound() {
            when(transactionRepository.findByExternalReference("INVALID"))
                    .thenReturn(Optional.empty());

            assertThatThrownBy(() -> paymentService.processWebhook(
                    PaymentProvider.CAMPAY, "INVALID", "SUCCESSFUL", null, null))
                    .isInstanceOf(PaymentException.class)
                    .hasMessageContaining("Transaction not found");
        }
    }

    // ── Queries ──────────────────────────────────────────────────────────────

    @Test
    void shouldGetTransactionByReference() {
        Transaction tx = Transaction.builder().externalReference("EXT-001").build();
        when(transactionRepository.findByExternalReference("EXT-001")).thenReturn(Optional.of(tx));

        Transaction result = paymentService.getTransactionByReference("EXT-001");

        assertThat(result.getExternalReference()).isEqualTo("EXT-001");
    }

    @Test
    void shouldThrowWhenTransactionByReferenceNotFound() {
        when(transactionRepository.findByExternalReference("INVALID")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> paymentService.getTransactionByReference("INVALID"))
                .isInstanceOf(PaymentException.class);
    }

    @Test
    void shouldGetTransactionsByMachine() {
        when(transactionRepository.findByMachineIdOrderByCreatedAtDesc("MACH-01"))
                .thenReturn(List.of(Transaction.builder().machineId("MACH-01").build()));

        List<Transaction> result = paymentService.getTransactionsByMachine("MACH-01");

        assertThat(result).hasSize(1);
    }

    @Test
    void shouldGetTransactionsByCard() {
        when(transactionRepository.findByRfidCardUidOrderByCreatedAtDesc("ABC123"))
                .thenReturn(List.of(Transaction.builder().rfidCardUid("ABC123").build()));

        List<Transaction> result = paymentService.getTransactionsByCard("ABC123");

        assertThat(result).hasSize(1);
    }

    @Test
    void shouldGetProviderStatus() {
        when(campayService.isConfigured()).thenReturn(true);
        when(mtnMomoService.isConfigured()).thenReturn(false);
        when(orangeMoneyService.isConfigured()).thenReturn(true);

        Map<String, Object> result = paymentService.getProviderStatus();

        assertThat(result).containsKeys("campay", "mtn", "orange_money");
    }
}
