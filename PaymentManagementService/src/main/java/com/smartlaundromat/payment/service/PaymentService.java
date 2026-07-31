package com.smartlaundromat.payment.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.smartlaundromat.payment.dto.PaymentInitiationRequest;
import com.smartlaundromat.payment.dto.PaymentResponse;
import com.smartlaundromat.payment.exception.PaymentException;
import com.smartlaundromat.payment.model.IdempotencyKey;
import com.smartlaundromat.payment.model.OutboxEvent;
import com.smartlaundromat.payment.model.PaymentEvent;
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
import com.smartlaundromat.payment.service.provider.PaymentProviderService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.LocalDateTime;
import java.time.OffsetDateTime;
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
    private final PaymentEventRepository paymentEventRepository;
    private final IdempotencyKeyRepository idempotencyKeyRepository;
    private final ObjectMapper objectMapper;
    private final MachineAvailabilityClient machineAvailabilityClient;
    private final ReservationClient reservationClient;

    private final CampayService campayService;

    // ── Payment initiation ────────────────────────────────────────────────────

    @Transactional
    public PaymentResponse initiatePayment(PaymentInitiationRequest request) {
        log.info("Initiating payment: machine={}, amount={}, provider={}",
                request.getMachineId(), request.getAmount(), request.getProvider());

        if (StringUtils.hasText(request.getIdempotencyKey())) {
            Optional<PaymentResponse> cached = replayIfIdempotencyKeyKnown(request.getIdempotencyKey());
            if (cached.isPresent()) {
                log.info("Idempotency key {} already processed, returning existing result", request.getIdempotencyKey());
                return cached.get();
            }
        }

        if (!machineAvailabilityClient.isAvailable(request.getMachineId())) {
            log.warn("Machine {} is not available, rejecting new payment request", request.getMachineId());
            throw new PaymentException("MACHINE_BUSY",
                    "Machine " + request.getMachineId() + " is not available");
        }
        // Checked before the reservation-code/conflict validation below (both remote calls): a
        // machine already mid-checkout should be rejected as PENDING_PAYMENT from local state
        // alone, without spending a round-trip (and risking a fail-closed error) on a request
        // that's going to be rejected regardless of reservation state.
        List<Transaction> pendingPayments = transactionRepository
                .findByMachineIdAndStatus(request.getMachineId(), PaymentStatus.PENDING);
        if (!pendingPayments.isEmpty()) {
            log.warn("Machine {} has a pending payment, rejecting new payment request", request.getMachineId());
            throw new PaymentException("PENDING_PAYMENT",
                    "Machine " + request.getMachineId() + " has a pending payment");
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
                .reservationHold(request.isReservationHold())
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

        recordPaymentEvent(transaction, PaymentStatus.PENDING, Map.of());

        if (StringUtils.hasText(request.getIdempotencyKey())) {
            registerIdempotencyKey(request.getIdempotencyKey(), externalReference);
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
     * Processes a payment provider callback (CamPay).
     *
     * <p>On {@code SUCCESSFUL}: marks the transaction and writes a
     * {@code PaymentSucceeded} event to the {@code outbox} table in the same
     * Postgres transaction (ACID). The {@link OutboxRelayService} picks it up
     * asynchronously and dispatches to MachineStateService — decoupling the
     * payment commit from the machine-start HTTP call (P4, W5/W10).
     *
     * <p>Locked fetch: payment providers retry webhook delivery on timeout, so two
     * genuinely concurrent calls for the same externalReference are a real
     * possibility, not just sequential retries. Without the lock, both could read
     * PENDING before either commits, both pass the already-successful check below,
     * and both write a SUCCESSFUL update / outbox event.
     */
    @Transactional
    public Transaction processWebhook(PaymentProvider provider,
                                      String externalReference,
                                      String status,
                                      String providerReference,
                                      String failureReason) {

        Transaction transaction = transactionRepository.findByExternalReferenceForUpdate(externalReference)
                .orElseThrow(() -> new PaymentException("TRANSACTION_NOT_FOUND",
                        "Transaction not found: " + externalReference));

        if (transaction.getStatus() == PaymentStatus.SUCCESSFUL) {
            log.info("Transaction already successful, skipping: {}", externalReference);
            return transaction;
        }

        if ("SUCCESSFUL".equalsIgnoreCase(status)) {
            transaction.setStatus(PaymentStatus.SUCCESSFUL);
            transaction.setProviderReference(providerReference);

            log.info("Payment SUCCESSFUL — tx={}, machine={}, provider={}",
                    externalReference, transaction.getMachineId(), provider);

            if (transaction.isReservationHold()) {
                // This fee only confirms/holds a future slot — the machine must not start
                // now, so no outbox event is written here. Reservation activation
                // (PENDING_PAYMENT -> ACTIVE) happens entirely outside this service: the
                // bot detects this payment success on its own (polling PaymentStatusWorker)
                // and calls MachineStateService's /api/reservations/activate directly.
                transactionRepository.save(transaction);
                log.info("Reservation hold fee confirmed — skipping machine-start dispatch: tx={}, machine={}",
                        externalReference, transaction.getMachineId());
            } else {
                transaction.setCycleStartedAt(LocalDateTime.now());
                transactionRepository.save(transaction);
                outboxEventRepository.save(buildPaymentSucceededEvent(transaction));
            }

            recordPaymentEvent(transaction, PaymentStatus.SUCCESSFUL,
                    Map.of("providerReference", String.valueOf(providerReference)));

        } else {
            transaction.setStatus(PaymentStatus.FAILED);
            transaction.setFailureReason(failureReason);
            transactionRepository.save(transaction);

            recordPaymentEvent(transaction, PaymentStatus.FAILED,
                    Map.of("failureReason", String.valueOf(failureReason)));
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
                // cycleStartedAt is only set for transactions that actually started a
                // machine (see processWebhook) — reservation-hold fee payments never set
                // it, so they're correctly excluded here rather than being mistaken for
                // an active cycle based on their own createdAt.
                .filter(tx -> tx.getCycleStartedAt() != null
                        && tx.getCycleStartedAt().plusMinutes(tx.getCycleDuration()).isAfter(now))
                .toList();
    }

    public Map<String, Object> getProviderStatus() {
        return Map.of(
                "campay", Map.of("configured", campayService.isConfigured())
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

    /**
     * Appends one immutable row to the {@code payment_events} ledger — never updates or
     * replaces a prior row. {@code transactions.status} remains the fast "current state"
     * lookup; this is the audit trail of every state it has ever passed through.
     */
    private void recordPaymentEvent(Transaction tx, PaymentStatus eventType, Map<String, Object> extraContext) {
        try {
            PaymentEvent event = PaymentEvent.builder()
                    .transactionId(tx.getId())
                    .externalReference(tx.getExternalReference())
                    .eventType(eventType)
                    .rawPayload(extraContext.isEmpty() ? null : objectMapper.writeValueAsString(extraContext))
                    .build();
            paymentEventRepository.save(event);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Cannot serialize payment event payload for tx " + tx.getExternalReference(), e);
        }
    }

    /**
     * Looks up a previously-processed idempotency key and, if found, rebuilds a response
     * from the linked transaction's current state — not a frozen snapshot of what the
     * original request returned, so a replay after settlement sees SUCCESSFUL/FAILED
     * rather than a stale PENDING.
     */
    private Optional<PaymentResponse> replayIfIdempotencyKeyKnown(String idempotencyKey) {
        return idempotencyKeyRepository.findByIdempotencyKey(idempotencyKey)
                .map(key -> transactionRepository.findByExternalReference(key.getExternalReference())
                        .orElseThrow(() -> new IllegalStateException(
                                "idempotency_keys row references a missing transaction: " + key.getExternalReference())))
                .map(this::buildResponseFromTransaction);
    }

    /**
     * Registers the idempotency key against the just-created transaction, before any
     * provider call is made.
     *
     * <p>On a unique-constraint violation on {@code idempotency_key} (a concurrent request
     * for the same key won the race), this deliberately does <strong>not</strong> try to
     * recover in-transaction by reading back the winner's row: on Postgres, a failed
     * statement aborts the whole surrounding transaction, so any further read here would
     * itself fail against the now-aborted transaction. Instead this rethrows as a plain
     * {@code PaymentException}, rolling back this whole request's transaction cleanly
     * (including the just-created PENDING row — no orphan left behind, unlike a
     * recover-in-place approach would leave). The caller retries the same idempotency key
     * in a fresh request/transaction, at which point {@link #replayIfIdempotencyKeyKnown}
     * finds the winner's now-committed row.
     *
     * <p>Only the {@code idempotency_key} unique-constraint violation means "concurrency
     * conflict" — any other integrity violation (e.g. the {@code external_reference} FK)
     * is a real bug and must not be masked as a routine conflict, same reasoning as the
     * pending-payment race guard above.
     */
    private void registerIdempotencyKey(String idempotencyKey, String externalReference) {
        try {
            idempotencyKeyRepository.save(IdempotencyKey.builder()
                    .idempotencyKey(idempotencyKey)
                    .externalReference(externalReference)
                    .expiresAt(OffsetDateTime.now().plusHours(24))
                    .build());
        } catch (DataIntegrityViolationException exception) {
            String cause = String.valueOf(exception.getMostSpecificCause().getMessage());
            if (!cause.contains("idempotency_keys_idempotency_key_key")) {
                throw exception;
            }
            log.warn("Idempotency key {} registered concurrently by another request", idempotencyKey);
            throw new PaymentException("IDEMPOTENCY_KEY_CONFLICT",
                    "A payment with idempotency key " + idempotencyKey + " is already being processed — retry shortly");
        }
    }

    private PaymentResponse buildResponseFromTransaction(Transaction transaction) {
        boolean success = transaction.getStatus() != PaymentStatus.FAILED
                && transaction.getStatus() != PaymentStatus.TIMEOUT;

        return PaymentResponse.builder()
                .success(success)
                .externalReference(transaction.getExternalReference())
                .providerReference(transaction.getProviderReference())
                .provider(transaction.getPaymentProvider())
                .status(transaction.getStatus())
                .amount(transaction.getAmount())
                .message("Idempotent replay of existing payment")
                .build();
    }

    private PaymentProviderService resolveProvider(PaymentProvider provider) {
        return switch (provider) {
            case CAMPAY -> campayService;
            case MTN, ORANGE_MONEY -> throw new PaymentException("PROVIDER_DISABLED",
                    provider + " is no longer supported — CamPay only");
        };
    }
}
