package com.smartlaundromat.payment.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.smartlaundromat.payment.dto.PaymentInitiationRequest;
import com.smartlaundromat.payment.dto.PaymentResponse;
import com.smartlaundromat.payment.exception.PaymentException;
import com.smartlaundromat.payment.model.IdempotencyKey;
import com.smartlaundromat.payment.model.OutboxEvent;
import com.smartlaundromat.payment.model.Transaction;
import com.smartlaundromat.payment.model.enums.PaymentProvider;
import com.smartlaundromat.payment.model.enums.PaymentStatus;
import com.smartlaundromat.payment.repository.IdempotencyKeyRepository;
import com.smartlaundromat.payment.repository.OutboxEventRepository;
import com.smartlaundromat.payment.repository.PaymentEventRepository;
import com.smartlaundromat.payment.repository.TransactionRepository;
import com.smartlaundromat.payment.service.machine.MachineAvailabilityClient;
import com.smartlaundromat.payment.service.machine.ReservationClient;
import com.smartlaundromat.payment.service.provider.CampayService;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.dao.DataIntegrityViolationException;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
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

    @Mock
    PaymentEventRepository paymentEventRepository;

    @Mock
    IdempotencyKeyRepository idempotencyKeyRepository;

    @Spy
    ObjectMapper objectMapper;

    @Mock
    CampayService campayService;

    @Mock
    MachineAvailabilityClient machineAvailabilityClient;

    @Mock
    ReservationClient reservationClient;

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
            when(machineAvailabilityClient.isAvailable("MACH-01")).thenReturn(true);
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
            verify(paymentEventRepository).save(argThat(event -> PaymentStatus.PENDING.equals(event.getEventType())));
        }

        @Test
        void shouldCarryReservationHoldFlagOntoTransaction() {
            request.setReservationHold(true);
            when(machineAvailabilityClient.isAvailable("MACH-01")).thenReturn(true);
            when(transactionRepository.findByMachineIdAndStatus("MACH-01", PaymentStatus.PENDING))
                    .thenReturn(Collections.emptyList());
            when(transactionRepository.save(any(Transaction.class))).thenAnswer(inv -> inv.getArgument(0));
            when(campayService.requestPayment(anyString(), any(), anyString(), anyString()))
                    .thenReturn(PaymentResponse.builder().success(true).providerReference("CAMP-REF-002").build());

            paymentService.initiatePayment(request);

            verify(transactionRepository, atLeastOnce()).save(argThat(Transaction::isReservationHold));
        }

        @Test
        void shouldThrowWhenMachineIsNotAvailable() {
            when(machineAvailabilityClient.isAvailable("MACH-01")).thenReturn(false);

            assertThatThrownBy(() -> paymentService.initiatePayment(request))
                    .isInstanceOf(PaymentException.class)
                    .hasMessageContaining("not available");
        }

        @Test
        void shouldThrowWhenMachineStatusUnknown() {
            when(machineAvailabilityClient.isAvailable("MACH-01"))
                    .thenThrow(new PaymentException("MACHINE_STATUS_UNKNOWN", "Could not verify status of machine MACH-01"));

            assertThatThrownBy(() -> paymentService.initiatePayment(request))
                    .isInstanceOf(PaymentException.class)
                    .hasMessageContaining("Could not verify status");
        }

        @Test
        void shouldThrowWhenMachineHasPendingPayment() {
            when(machineAvailabilityClient.isAvailable("MACH-01")).thenReturn(true);
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
        void shouldInitiatePaymentWhenReservationCodeValid() {
            request.setReservationCode("RES-ABC123");
            when(machineAvailabilityClient.isAvailable("MACH-01")).thenReturn(true);
            when(reservationClient.isValid("RES-ABC123", "MACH-01")).thenReturn(true);
            when(transactionRepository.findByMachineIdAndStatus("MACH-01", PaymentStatus.PENDING))
                    .thenReturn(Collections.emptyList());
            when(transactionRepository.save(any(Transaction.class))).thenAnswer(inv -> inv.getArgument(0));

            PaymentResponse providerResponse = PaymentResponse.builder()
                    .success(true)
                    .providerReference("CAMP-REF-001")
                    .build();
            when(campayService.requestPayment(anyString(), any(), anyString(), anyString()))
                    .thenReturn(providerResponse);

            paymentService.initiatePayment(request);

            verify(transactionRepository, times(2)).save(argThat(tx -> "RES-ABC123".equals(tx.getReservationCode())));
        }

        @Test
        void shouldThrowWhenReservationCodeInvalid() {
            request.setReservationCode("RES-ABC123");
            when(machineAvailabilityClient.isAvailable("MACH-01")).thenReturn(true);
            when(reservationClient.isValid("RES-ABC123", "MACH-01")).thenReturn(false);

            assertThatThrownBy(() -> paymentService.initiatePayment(request))
                    .isInstanceOf(PaymentException.class)
                    .hasMessageContaining("not valid");

            verifyNoInteractions(campayService);
            verify(transactionRepository, never()).save(any());
        }

        @Test
        void shouldSkipReservationCodeValidationWhenNoCodeProvided() {
            when(machineAvailabilityClient.isAvailable("MACH-01")).thenReturn(true);
            when(reservationClient.checkConflict("MACH-01", request.getCycleDuration(), null))
                    .thenReturn(Optional.empty());
            when(transactionRepository.findByMachineIdAndStatus("MACH-01", PaymentStatus.PENDING))
                    .thenReturn(Collections.emptyList());
            when(transactionRepository.save(any(Transaction.class))).thenAnswer(inv -> inv.getArgument(0));

            PaymentResponse providerResponse = PaymentResponse.builder()
                    .success(true)
                    .providerReference("CAMP-REF-001")
                    .build();
            when(campayService.requestPayment(anyString(), any(), anyString(), anyString()))
                    .thenReturn(providerResponse);

            paymentService.initiatePayment(request);

            verify(reservationClient, never()).isValid(any(), any());
        }

        @Test
        void shouldThrowWhenReservationConflictExists() {
            when(machineAvailabilityClient.isAvailable("MACH-01")).thenReturn(true);
            LocalDateTime conflictStart = LocalDateTime.now().plusMinutes(5);
            when(reservationClient.checkConflict("MACH-01", request.getCycleDuration(), null))
                    .thenReturn(Optional.of(conflictStart));

            assertThatThrownBy(() -> paymentService.initiatePayment(request))
                    .isInstanceOf(PaymentException.class)
                    .hasMessageContaining("reserved starting at");

            verifyNoInteractions(campayService);
            verify(transactionRepository, never()).save(any());
        }

        @Test
        void shouldProceedWhenNoReservationConflict() {
            when(machineAvailabilityClient.isAvailable("MACH-01")).thenReturn(true);
            when(reservationClient.checkConflict("MACH-01", request.getCycleDuration(), null))
                    .thenReturn(Optional.empty());
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
        }

        @Test
        void shouldRejectAsPendingPaymentWhenSaveRacesConcurrentInsert() {
            when(machineAvailabilityClient.isAvailable("MACH-01")).thenReturn(true);
            when(transactionRepository.findByMachineIdAndStatus("MACH-01", PaymentStatus.PENDING))
                    .thenReturn(Collections.emptyList());
            when(transactionRepository.save(any(Transaction.class)))
                    .thenThrow(new org.springframework.dao.DataIntegrityViolationException(
                            "duplicate key value violates unique constraint idx_transactions_machine_pending",
                            new RuntimeException("duplicate key value violates unique constraint \"idx_transactions_machine_pending\"")));

            assertThatThrownBy(() -> paymentService.initiatePayment(request))
                    .isInstanceOf(PaymentException.class)
                    .hasMessageContaining("pending payment");

            verifyNoInteractions(campayService);
        }

        @Test
        void shouldRethrowUnrelatedDataIntegrityViolations() {
            when(machineAvailabilityClient.isAvailable("MACH-01")).thenReturn(true);
            when(transactionRepository.findByMachineIdAndStatus("MACH-01", PaymentStatus.PENDING))
                    .thenReturn(Collections.emptyList());
            when(transactionRepository.save(any(Transaction.class)))
                    .thenThrow(new org.springframework.dao.DataIntegrityViolationException(
                            "value too long for type character varying(30)",
                            new RuntimeException("value too long for type character varying(30)")));

            assertThatThrownBy(() -> paymentService.initiatePayment(request))
                    .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class)
                    .isNotInstanceOf(PaymentException.class);

            verifyNoInteractions(campayService);
        }

        @Test
        void shouldThrowWhenMtnProviderRequested() {
            request.setProvider(PaymentProvider.MTN);
            when(machineAvailabilityClient.isAvailable(anyString())).thenReturn(true);
            when(transactionRepository.findByMachineIdAndStatus(anyString(), eq(PaymentStatus.PENDING)))
                    .thenReturn(Collections.emptyList());
            when(transactionRepository.save(any(Transaction.class))).thenAnswer(inv -> inv.getArgument(0));

            assertThatThrownBy(() -> paymentService.initiatePayment(request))
                    .isInstanceOf(PaymentException.class)
                    .satisfies(ex -> assertThat(((PaymentException) ex).getErrorCode()).isEqualTo("PROVIDER_DISABLED"));

            verifyNoInteractions(campayService);
        }

        @Test
        void shouldThrowWhenOrangeProviderRequested() {
            request.setProvider(PaymentProvider.ORANGE_MONEY);
            when(machineAvailabilityClient.isAvailable(anyString())).thenReturn(true);
            when(transactionRepository.findByMachineIdAndStatus(anyString(), eq(PaymentStatus.PENDING)))
                    .thenReturn(Collections.emptyList());
            when(transactionRepository.save(any(Transaction.class))).thenAnswer(inv -> inv.getArgument(0));

            assertThatThrownBy(() -> paymentService.initiatePayment(request))
                    .isInstanceOf(PaymentException.class)
                    .satisfies(ex -> assertThat(((PaymentException) ex).getErrorCode()).isEqualTo("PROVIDER_DISABLED"));

            verifyNoInteractions(campayService);
        }

        @Test
        void shouldProceedNormallyWhenNoIdempotencyKeyProvided() {
            when(machineAvailabilityClient.isAvailable("MACH-01")).thenReturn(true);
            when(transactionRepository.findByMachineIdAndStatus("MACH-01", PaymentStatus.PENDING))
                    .thenReturn(Collections.emptyList());
            when(transactionRepository.save(any(Transaction.class))).thenAnswer(inv -> inv.getArgument(0));
            when(campayService.requestPayment(anyString(), any(), anyString(), anyString()))
                    .thenReturn(PaymentResponse.builder().success(true).providerReference("CAMP-REF-001").build());

            paymentService.initiatePayment(request);

            verifyNoInteractions(idempotencyKeyRepository);
        }

        @Test
        void shouldReturnExistingTransactionWhenIdempotencyKeyAlreadyProcessed() {
            request.setIdempotencyKey("IDEMP-001");

            IdempotencyKey existingKey = IdempotencyKey.builder()
                    .idempotencyKey("IDEMP-001")
                    .externalReference("EXT-EXISTING")
                    .expiresAt(OffsetDateTime.now().plusHours(24))
                    .build();
            when(idempotencyKeyRepository.findByIdempotencyKey("IDEMP-001")).thenReturn(Optional.of(existingKey));

            Transaction existingTransaction = Transaction.builder()
                    .externalReference("EXT-EXISTING")
                    .machineId("MACH-01")
                    .amount(new BigDecimal("1000"))
                    .status(PaymentStatus.SUCCESSFUL)
                    .providerReference("CAMP-REF-EXISTING")
                    .build();
            when(transactionRepository.findByExternalReference("EXT-EXISTING")).thenReturn(Optional.of(existingTransaction));

            PaymentResponse result = paymentService.initiatePayment(request);

            assertThat(result.getExternalReference()).isEqualTo("EXT-EXISTING");
            assertThat(result.getStatus()).isEqualTo(PaymentStatus.SUCCESSFUL);
            assertThat(result.isSuccess()).isTrue();
            verifyNoInteractions(machineAvailabilityClient, campayService);
            verify(transactionRepository, never()).save(any());
        }

        @Test
        void shouldPersistIdempotencyKeyAfterSuccessfulInitiation() {
            request.setIdempotencyKey("IDEMP-002");
            when(idempotencyKeyRepository.findByIdempotencyKey("IDEMP-002")).thenReturn(Optional.empty());
            when(machineAvailabilityClient.isAvailable("MACH-01")).thenReturn(true);
            when(transactionRepository.findByMachineIdAndStatus("MACH-01", PaymentStatus.PENDING))
                    .thenReturn(Collections.emptyList());
            when(transactionRepository.save(any(Transaction.class))).thenAnswer(inv -> inv.getArgument(0));
            when(campayService.requestPayment(anyString(), any(), anyString(), anyString()))
                    .thenReturn(PaymentResponse.builder().success(true).providerReference("CAMP-REF-001").build());

            paymentService.initiatePayment(request);

            verify(idempotencyKeyRepository).save(argThat(key ->
                    "IDEMP-002".equals(key.getIdempotencyKey()) && key.getExternalReference() != null));
        }

        @Test
        void shouldThrowRetryableConflictWhenIdempotencyKeySaveRaces() {
            // A concurrent request already committed this key by the time this request tries
            // to register it — don't attempt to recover in the same transaction (a failed
            // statement aborts the whole transaction on Postgres, so further reads here would
            // themselves fail); roll back cleanly and let the caller retry with a fresh request.
            request.setIdempotencyKey("IDEMP-003");
            when(idempotencyKeyRepository.findByIdempotencyKey("IDEMP-003")).thenReturn(Optional.empty());
            when(machineAvailabilityClient.isAvailable("MACH-01")).thenReturn(true);
            when(transactionRepository.findByMachineIdAndStatus("MACH-01", PaymentStatus.PENDING))
                    .thenReturn(Collections.emptyList());
            when(transactionRepository.save(any(Transaction.class))).thenAnswer(inv -> inv.getArgument(0));
            when(idempotencyKeyRepository.save(any(IdempotencyKey.class)))
                    .thenThrow(new DataIntegrityViolationException(
                            "duplicate key value violates unique constraint \"idempotency_keys_idempotency_key_key\""));

            assertThatThrownBy(() -> paymentService.initiatePayment(request))
                    .isInstanceOf(PaymentException.class)
                    .satisfies(ex -> assertThat(((PaymentException) ex).getErrorCode()).isEqualTo("IDEMPOTENCY_KEY_CONFLICT"));

            verifyNoInteractions(campayService);
        }

        @Test
        void shouldRethrowUnrelatedIntegrityViolationOnIdempotencyKeySave() {
            // A DataIntegrityViolationException unrelated to the idempotency_key unique
            // constraint (e.g. the external_reference FK) is a real bug and must not be
            // masked as a routine concurrency conflict.
            request.setIdempotencyKey("IDEMP-004");
            when(idempotencyKeyRepository.findByIdempotencyKey("IDEMP-004")).thenReturn(Optional.empty());
            when(machineAvailabilityClient.isAvailable("MACH-01")).thenReturn(true);
            when(transactionRepository.findByMachineIdAndStatus("MACH-01", PaymentStatus.PENDING))
                    .thenReturn(Collections.emptyList());
            when(transactionRepository.save(any(Transaction.class))).thenAnswer(inv -> inv.getArgument(0));
            when(idempotencyKeyRepository.save(any(IdempotencyKey.class)))
                    .thenThrow(new DataIntegrityViolationException(
                            "insert or update on table \"idempotency_keys\" violates foreign key constraint"));

            assertThatThrownBy(() -> paymentService.initiatePayment(request))
                    .isInstanceOf(DataIntegrityViolationException.class)
                    .isNotInstanceOf(PaymentException.class);

            verifyNoInteractions(campayService);
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
            when(transactionRepository.findByExternalReferenceForUpdate("EXT-001"))
                    .thenReturn(Optional.of(transaction));
            when(transactionRepository.save(any(Transaction.class))).thenAnswer(inv -> inv.getArgument(0));
            when(outboxEventRepository.save(any(OutboxEvent.class))).thenAnswer(inv -> inv.getArgument(0));

            Transaction result = paymentService.processWebhook(
                    PaymentProvider.CAMPAY, "EXT-001", "SUCCESSFUL", "PROV-001", null);

            assertThat(result.getStatus()).isEqualTo(PaymentStatus.SUCCESSFUL);
            assertThat(result.getProviderReference()).isEqualTo("PROV-001");
            assertThat(result.getCycleStartedAt()).isNotNull();
            verify(outboxEventRepository).save(argThat(event ->
                    "PaymentSucceeded".equals(event.getEventType())
                    && "EXT-001".equals(event.getAggregateId())
                    && event.getPayload().contains("MACH-01")
            ));
            verify(paymentEventRepository).save(argThat(event ->
                    PaymentStatus.SUCCESSFUL.equals(event.getEventType())
                    && "EXT-001".equals(event.getExternalReference())
            ));
        }

        @Test
        void shouldSkipMachineStartAndCycleStartedAtForReservationHold() {
            Transaction transaction = Transaction.builder()
                    .externalReference("EXT-HOLD-01")
                    .machineId("washer_02")
                    .pulseCount(1)
                    .cycleDuration(60)
                    .reservationHold(true)
                    .status(PaymentStatus.PENDING)
                    .build();
            when(transactionRepository.findByExternalReferenceForUpdate("EXT-HOLD-01"))
                    .thenReturn(Optional.of(transaction));
            when(transactionRepository.save(any(Transaction.class))).thenAnswer(inv -> inv.getArgument(0));

            Transaction result = paymentService.processWebhook(
                    PaymentProvider.CAMPAY, "EXT-HOLD-01", "SUCCESSFUL", "PROV-HOLD-01", null);

            assertThat(result.getStatus()).isEqualTo(PaymentStatus.SUCCESSFUL);
            assertThat(result.getCycleStartedAt()).isNull();
            verify(outboxEventRepository, never()).save(any());
            verify(paymentEventRepository).save(argThat(event ->
                    PaymentStatus.SUCCESSFUL.equals(event.getEventType())
                    && "EXT-HOLD-01".equals(event.getExternalReference())
            ));
        }

        @Test
        void shouldIncludeReservationCodeInOutboxPayloadWhenPresent() {
            Transaction transaction = Transaction.builder()
                    .externalReference("EXT-004")
                    .machineId("MACH-01")
                    .pulseCount(2)
                    .cycleDuration(60)
                    .reservationCode("RES-ABC123")
                    .status(PaymentStatus.PENDING)
                    .build();
            when(transactionRepository.findByExternalReferenceForUpdate("EXT-004"))
                    .thenReturn(Optional.of(transaction));
            when(transactionRepository.save(any(Transaction.class))).thenAnswer(inv -> inv.getArgument(0));
            when(outboxEventRepository.save(any(OutboxEvent.class))).thenAnswer(inv -> inv.getArgument(0));

            paymentService.processWebhook(PaymentProvider.CAMPAY, "EXT-004", "SUCCESSFUL", "PROV-004", null);

            verify(outboxEventRepository).save(argThat(event ->
                    event.getPayload().contains("RES-ABC123")
            ));
        }

        @Test
        void shouldOmitReservationCodeFromOutboxPayloadWhenAbsent() {
            Transaction transaction = Transaction.builder()
                    .externalReference("EXT-001")
                    .machineId("MACH-01")
                    .pulseCount(2)
                    .cycleDuration(30)
                    .status(PaymentStatus.PENDING)
                    .build();
            when(transactionRepository.findByExternalReferenceForUpdate("EXT-001"))
                    .thenReturn(Optional.of(transaction));
            when(transactionRepository.save(any(Transaction.class))).thenAnswer(inv -> inv.getArgument(0));
            when(outboxEventRepository.save(any(OutboxEvent.class))).thenAnswer(inv -> inv.getArgument(0));

            paymentService.processWebhook(PaymentProvider.CAMPAY, "EXT-001", "SUCCESSFUL", "PROV-001", null);

            verify(outboxEventRepository).save(argThat(event ->
                    !event.getPayload().contains("reservationCode")
            ));
        }

        @Test
        void shouldMarkTransactionFailedWithNoOutboxWrite() {
            Transaction transaction = Transaction.builder()
                    .externalReference("EXT-001")
                    .status(PaymentStatus.PENDING)
                    .build();
            when(transactionRepository.findByExternalReferenceForUpdate("EXT-001"))
                    .thenReturn(Optional.of(transaction));
            when(transactionRepository.save(any(Transaction.class))).thenAnswer(inv -> inv.getArgument(0));

            Transaction result = paymentService.processWebhook(
                    PaymentProvider.CAMPAY, "EXT-001", "FAILED", null, "Insufficient funds");

            assertThat(result.getStatus()).isEqualTo(PaymentStatus.FAILED);
            assertThat(result.getFailureReason()).isEqualTo("Insufficient funds");
            verify(outboxEventRepository, never()).save(any());
            verify(paymentEventRepository).save(argThat(event ->
                    PaymentStatus.FAILED.equals(event.getEventType())
                    && "EXT-001".equals(event.getExternalReference())
            ));
        }

        @Test
        void shouldSkipAlreadySuccessfulTransaction() {
            Transaction transaction = Transaction.builder()
                    .externalReference("EXT-001")
                    .status(PaymentStatus.SUCCESSFUL)
                    .build();
            when(transactionRepository.findByExternalReferenceForUpdate("EXT-001"))
                    .thenReturn(Optional.of(transaction));

            Transaction result = paymentService.processWebhook(
                    PaymentProvider.CAMPAY, "EXT-001", "SUCCESSFUL", "PROV-001", null);

            assertThat(result.getStatus()).isEqualTo(PaymentStatus.SUCCESSFUL);
            verify(transactionRepository, never()).save(any());
            verify(outboxEventRepository, never()).save(any());
        }

        @Test
        void shouldThrowWhenTransactionNotFound() {
            when(transactionRepository.findByExternalReferenceForUpdate("INVALID"))
                    .thenReturn(Optional.empty());

            assertThatThrownBy(() -> paymentService.processWebhook(
                    PaymentProvider.CAMPAY, "INVALID", "SUCCESSFUL", null, null))
                    .isInstanceOf(PaymentException.class)
                    .hasMessageContaining("Transaction not found");
        }

        @Test
        void shouldUseLockedFetchNotPlainReadForWebhookProcessing() {
            // given — payment providers retry webhook delivery on timeout, so two genuinely
            // concurrent calls for the same externalReference are a real possibility. This
            // asserts processWebhook goes through the row-locking repository method, not the
            // plain findByExternalReference used by read-only lookups (getTransactionByReference),
            // which would leave the status-check-then-write open to a race.
            Transaction transaction = Transaction.builder()
                    .externalReference("EXT-001")
                    .machineId("MACH-01")
                    .pulseCount(2)
                    .cycleDuration(30)
                    .status(PaymentStatus.PENDING)
                    .build();
            when(transactionRepository.findByExternalReferenceForUpdate("EXT-001"))
                    .thenReturn(Optional.of(transaction));
            when(transactionRepository.save(any(Transaction.class))).thenAnswer(inv -> inv.getArgument(0));
            when(outboxEventRepository.save(any(OutboxEvent.class))).thenAnswer(inv -> inv.getArgument(0));

            paymentService.processWebhook(PaymentProvider.CAMPAY, "EXT-001", "SUCCESSFUL", "PROV-001", null);

            verify(transactionRepository).findByExternalReferenceForUpdate("EXT-001");
            verify(transactionRepository, never()).findByExternalReference(anyString());
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
    void shouldGetMultipleActiveCyclesByPhone() {
        Transaction washer = Transaction.builder()
                .machineId("washer_01").phoneNumber("237612345678")
                .status(PaymentStatus.SUCCESSFUL)
                .cycleDuration(60).cycleStartedAt(LocalDateTime.now().minusMinutes(10))
                .build();
        Transaction dryer = Transaction.builder()
                .machineId("dryer_02").phoneNumber("237612345678")
                .status(PaymentStatus.SUCCESSFUL)
                .cycleDuration(30).cycleStartedAt(LocalDateTime.now().minusMinutes(5))
                .build();
        when(transactionRepository.findByPhoneNumberAndStatusOrderByCreatedAtDesc("237612345678", PaymentStatus.SUCCESSFUL))
                .thenReturn(List.of(washer, dryer));

        List<Transaction> result = paymentService.getActiveCyclesByPhone("237612345678");

        assertThat(result).hasSize(2).extracting(Transaction::getMachineId)
                .containsExactly("washer_01", "dryer_02");
    }

    @Test
    void shouldExcludeFinishedCyclesFromActiveCyclesByPhone() {
        Transaction finished = Transaction.builder()
                .machineId("washer_01").phoneNumber("237612345678")
                .status(PaymentStatus.SUCCESSFUL)
                .cycleDuration(30).cycleStartedAt(LocalDateTime.now().minusMinutes(45))
                .build();
        Transaction stillRunning = Transaction.builder()
                .machineId("dryer_02").phoneNumber("237612345678")
                .status(PaymentStatus.SUCCESSFUL)
                .cycleDuration(60).cycleStartedAt(LocalDateTime.now().minusMinutes(5))
                .build();
        when(transactionRepository.findByPhoneNumberAndStatusOrderByCreatedAtDesc("237612345678", PaymentStatus.SUCCESSFUL))
                .thenReturn(List.of(finished, stillRunning));

        List<Transaction> result = paymentService.getActiveCyclesByPhone("237612345678");

        assertThat(result).extracting(Transaction::getMachineId).containsExactly("dryer_02");
    }

    @Test
    void shouldExcludeReservationHoldFeeFromActiveCyclesByPhone() {
        // A reservation-fee payment's createdAt is "now" and its cycleDuration is the
        // reserved slot's length — without the cycleStartedAt gate this would look
        // identical to a real, currently-running cycle even though nothing has started.
        Transaction reservationHold = Transaction.builder()
                .machineId("washer_02").phoneNumber("237612345678")
                .status(PaymentStatus.SUCCESSFUL)
                .cycleDuration(60).createdAt(LocalDateTime.now())
                .reservationHold(true)
                .cycleStartedAt(null)
                .build();
        when(transactionRepository.findByPhoneNumberAndStatusOrderByCreatedAtDesc("237612345678", PaymentStatus.SUCCESSFUL))
                .thenReturn(List.of(reservationHold));

        List<Transaction> result = paymentService.getActiveCyclesByPhone("237612345678");

        assertThat(result).isEmpty();
    }

    @Test
    void shouldGetProviderStatus() {
        when(campayService.isConfigured()).thenReturn(true);

        Map<String, Object> result = paymentService.getProviderStatus();

        assertThat(result).containsOnlyKeys("campay");
    }
}
