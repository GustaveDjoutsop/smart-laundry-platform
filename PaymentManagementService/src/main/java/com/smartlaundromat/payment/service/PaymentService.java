package com.smartlaundromat.payment.service;

import com.fasterxml.jackson.core.JsonProcessingException;
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
import com.smartlaundromat.payment.service.machine.MachineAvailabilityClient;
import com.smartlaundromat.payment.service.machine.ReservationClient;
import com.smartlaundromat.payment.service.provider.CampayService;
import com.smartlaundromat.payment.service.provider.MtnMomoService;
import com.smartlaundromat.payment.service.provider.OrangeMoneyService;
import com.smartlaundromat.payment.service.provider.PaymentProviderService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Service
@Slf4j
@RequiredArgsConstructor
public class PaymentService {

    private final TransactionRepository transactionRepository;
    private final OutboxEventRepository outboxEventRepository;
    private final ObjectMapper objectMapper;
    private final MachineAvailabilityClient machineAvailabilityClient;
    private final ReservationClient reservationClient;

    private final CampayService campayService;
    private final MtnMomoService mtnMomoService;
    private final OrangeMoneyService orangeMoneyService;

    // ── Payment initiation ────────────────────────────────────────────────────

    @Transactional
    public PaymentResponse initiatePayment(PaymentInitiationRequest request) {
        log.info("Initiating payment: machine={}, amount={}, provider={}",
                request.getMachineId(), request.getAmount(), request.getProvider());
        if (!machineAvailabilityClient.isAvailable(request.getMachineId())) {
            log.warn("Machine {} is not available, rejecting new payment request", request.getMachineId());
            throw new PaymentException("MACHINE_BUSY",
                    "Machine " + request.getMachineId() + " is not available");
        }
        if (StringUtils.hasText(request.getReservationCode())
                && !reservationClient.isValid(request.getReservationCode(), request.getMachineId())) {
            log.warn("Reservation code invalid for machine {}, rejecting new payment request", request.getMachineId());
            throw new PaymentException("RESERVATION_INVALID_CODE",
                    "Reservation code is not valid for machine " + request.getMachineId());
        }
        // Duration-aware: blocks a walk-in whose chosen cycle would run into someone else's
        // upcoming reservation, before charging. A supplied reservationCode is excluded from the
        // conflict search so a legitimate redemption never self-conflicts.
        reservationClient.checkConflict(request.getMachineId(), request.getCycleDuration(), request.getReservationCode())
                .ifPresent(conflictingSlotStart -> {
                    log.warn("Machine {} has a reservation starting at {}, rejecting new payment request",
                            request.getMachineId(), conflictingSlotStart);
                    throw new PaymentException("RESERVATION_SLOT_CONFLICT",
                            "Machine " + request.getMachineId() + " is reserved starting at " + conflictingSlotStart);
                });
        List<Transaction> pendingPayments = transactionRepository
                .findByMachineIdAndStatus(request.getMachineId(), PaymentStatus.PENDING);
        if (!pendingPayments.isEmpty()) {
            log.warn("Machine {} has a pending payment, rejecting new payment request", request.getMachineId());
            throw new PaymentException("PENDING_PAYMENT",
                    "Machine " + request.getMachineId() + " has a pending payment");
        }

        String externalReference = UUID.randomUUID().toString();

        Transaction transaction = Transaction.builder()
                .externalReference(externalReference)
                .amount(request.getAmount())
                .phoneNumber(request.getPhoneNumber())
                .machineId(request.getMachineId())
                .pulseCount(request.getPulseCount())
                .cycleDuration(request.getCycleDuration())
                .description(request.getDescription())
                .paymentProvider(request.getProvider())
                .reservationCode(request.getReservationCode())
                .build();

        log.info("save new transaction with external reference: {}", externalReference);
        try {
            transactionRepository.save(transaction);
        } catch (DataIntegrityViolationException exception) {
            // Backstop for the check-then-act race above: a concurrent request for the same
            // machine can win between the pending-payment check and this save. The unique
            // partial index on transactions(machine_id) WHERE status='PENDING' catches it here.
            // Only this specific constraint means "pending payment race" — any other integrity
            // violation is a real bug and must not be masked as a routine rejection.
            String cause = String.valueOf(exception.getMostSpecificCause().getMessage());
            if (cause.contains("idx_transactions_machine_pending")) {
                log.warn("Machine {} got a pending payment concurrently, rejecting this request", request.getMachineId());
                throw new PaymentException("PENDING_PAYMENT",
                        "Machine " + request.getMachineId() + " has a pending payment");
            }
            throw exception;
        }

        PaymentProviderService provider = resolveProvider(request.getProvider());
        log.info("Requesting payment from provider {}: externalReference={}, phoneNumber={}, amount={}",
                request.getProvider(), externalReference, request.getPhoneNumber(), request.getAmount());

        PaymentResponse response = provider.requestPayment(
                request.getPhoneNumber(),
                request.getAmount(),
                request.getDescription(),
                externalReference
        );

        log.info("Payment response received: {}", response);
        transaction.setProviderReference(response.getProviderReference());
        transactionRepository.save(transaction);

        log.info("transaction updated with provider reference: {}", transaction);
        return response;
    }

    // ── Webhook processing ────────────────────────────────────────────────────

    /**
     * Processes a payment provider callback (CamPay, MTN, or Orange Money).
     *
     * <p>On {@code SUCCESSFUL}: marks the transaction and writes a
     * {@code PaymentSucceeded} event to the {@code outbox} table in the same
     * Postgres transaction (ACID). The {@link OutboxRelayService} picks it up
     * asynchronously and dispatches to MachineStateService — decoupling the
     * payment commit from the machine-start HTTP call (P4, W5/W10).
     */
    @Transactional
    public Transaction processWebhook(PaymentProvider provider,
                                      String externalReference,
                                      String status,
                                      String providerReference,
                                      String failureReason) {

        Transaction transaction = transactionRepository.findByExternalReference(externalReference)
                .orElseThrow(() -> new PaymentException("TRANSACTION_NOT_FOUND",
                        "Transaction not found: " + externalReference));

        if (transaction.getStatus() == PaymentStatus.SUCCESSFUL) {
            log.info("Transaction already successful, skipping: {}", externalReference);
            return transaction;
        }

        if ("SUCCESSFUL".equalsIgnoreCase(status)) {
            transaction.setStatus(PaymentStatus.SUCCESSFUL);
            transaction.setProviderReference(providerReference);
            transaction.setCycleStartedAt(LocalDateTime.now());
            transactionRepository.save(transaction);

            log.info("Payment SUCCESSFUL — tx={}, machine={}, provider={}",
                    externalReference, transaction.getMachineId(), provider);

            outboxEventRepository.save(buildPaymentSucceededEvent(transaction));

        } else {
            transaction.setStatus(PaymentStatus.FAILED);
            transaction.setFailureReason(failureReason);
            transactionRepository.save(transaction);
        }

        return transaction;
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    public Transaction getTransactionByReference(String externalReference) {
        return transactionRepository.findByExternalReference(externalReference)
                .orElseThrow(() -> new PaymentException("TRANSACTION_NOT_FOUND",
                        "Transaction not found: " + externalReference));
    }

    public List<Transaction> getTransactionsByMachine(String machineId) {
        return transactionRepository.findByMachineIdOrderByCreatedAtDesc(machineId);
    }

    public List<Transaction> getTransactionsByCard(String cardUid) {
        return transactionRepository.findByRfidCardUidOrderByCreatedAtDesc(cardUid);
    }

    public List<Transaction> getActiveCyclesByPhone(String phone) {
        LocalDateTime now = LocalDateTime.now();
        return transactionRepository
                .findByPhoneNumberAndStatusOrderByCreatedAtDesc(phone, PaymentStatus.SUCCESSFUL)
                .stream()
                .filter(tx -> tx.getCreatedAt().plusMinutes(tx.getCycleDuration()).isAfter(now))
                .toList();
    }

    public Map<String, Object> getProviderStatus() {
        return Map.of(
                "campay",       Map.of("configured", campayService.isConfigured()),
                "mtn",          Map.of("configured", mtnMomoService.isConfigured()),
                "orange_money", Map.of("configured", orangeMoneyService.isConfigured())
        );
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private OutboxEvent buildPaymentSucceededEvent(Transaction tx) {
        Map<String, Object> payloadMap = new HashMap<>();
        payloadMap.put("machineId", tx.getMachineId());
        payloadMap.put("transactionReference", tx.getExternalReference());
        payloadMap.put("cycleType", "NORMAL");
        payloadMap.put("durationMinutes", tx.getCycleDuration() != null ? tx.getCycleDuration() : 30);
        payloadMap.put("pulseCount", tx.getPulseCount() != null ? tx.getPulseCount() : 1);
        if (tx.getReservationCode() != null) {
            payloadMap.put("reservationCode", tx.getReservationCode());
        }
        try {
            return OutboxEvent.builder()
                    .aggregateType("Transaction")
                    .aggregateId(tx.getExternalReference())
                    .eventType("PaymentSucceeded")
                    .payload(objectMapper.writeValueAsString(payloadMap))
                    .build();
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Cannot serialize outbox payload for tx " + tx.getExternalReference(), e);
        }
    }

    private PaymentProviderService resolveProvider(PaymentProvider provider) {
        return switch (provider) {
            case CAMPAY       -> campayService;
            case MTN          -> mtnMomoService;
            case ORANGE_MONEY -> orangeMoneyService;
        };
    }
}
