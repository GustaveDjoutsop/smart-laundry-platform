package com.smartlaundromat.payment.repository;

import com.smartlaundromat.payment.model.Transaction;
import com.smartlaundromat.payment.model.enums.PaymentStatus;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Repository
public interface TransactionRepository extends JpaRepository<Transaction, Long> {

    Optional<Transaction> findByExternalReference(String externalReference);

    /**
     * Locks the transaction row for the duration of the caller's transaction, so the
     * status-check-then-write in {@code PaymentService.processWebhook} can't race a
     * second, genuinely concurrent webhook delivery for the same externalReference
     * (payment providers do retry on timeout). Read-only lookups (GET endpoints)
     * must keep using {@link #findByExternalReference} — only the webhook write path
     * needs this.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT t FROM Transaction t WHERE t.externalReference = :externalReference")
    Optional<Transaction> findByExternalReferenceForUpdate(
            @Param("externalReference") String externalReference);

    List<Transaction> findByMachineIdAndStatus(String machineId, PaymentStatus status);

    List<Transaction> findByStatusAndCreatedAtBefore(PaymentStatus status, LocalDateTime before);

    List<Transaction> findByRfidCardUidOrderByCreatedAtDesc(String rfidCardUid);

    List<Transaction> findByMachineIdOrderByCreatedAtDesc(String machineId);

    List<Transaction> findByPhoneNumberAndStatusOrderByCreatedAtDesc(String phoneNumber, PaymentStatus status);

    List<Transaction> findByStatusAndReminderSentAtIsNullAndUpdatedAtAfter(PaymentStatus status, LocalDateTime after);

    List<Transaction> findByStatusAndCompletedNotifiedAtIsNullAndUpdatedAtAfter(PaymentStatus status, LocalDateTime after);

    /**
     * R4 reconciliation query: successful, non-reservation-hold payments whose machine
     * cycle started before {@code cutoff} but for which no {@code outbox} row has been
     * confirmed processed yet. A payment reaching {@code SUCCESSFUL} always writes its
     * outbox row in the same transaction it sets {@code cycleStartedAt} (see
     * {@code PaymentService.processWebhook}), so any match here means the pay→start
     * delivery is stuck (still retrying, dead-lettered, or — if this ever returns rows
     * for a very fresh transaction — the outbox write itself is missing, which would be
     * a separate bug). Anchored on {@code cycleStartedAt}, not {@code createdAt}: a
     * provider webhook that arrives late (after {@code PaymentTimeoutService} would
     * already have marked the transaction {@code TIMEOUT}, were it not for this exact
     * late-success race) can still flip it to {@code SUCCESSFUL} with a {@code createdAt}
     * already older than the grace period, which would falsely flag it as orphaned
     * before the outbox relay has had any chance to run. {@code cutoff} should be set
     * well past the outbox's max retry window so transient MachineStateService downtime
     * alone does not trigger a false positive. {@code reservationHold = false} doubles
     * as the null-guard for {@code cycleStartedAt}, which is only ever set on that path
     * (see {@code PaymentService#findActiveTransactionsByPhone}).
     */
    @Query("SELECT t FROM Transaction t WHERE t.status = com.smartlaundromat.payment.model.enums.PaymentStatus.SUCCESSFUL "
            + "AND t.reservationHold = false "
            + "AND t.cycleStartedAt < :cutoff "
            + "AND NOT EXISTS (SELECT 1 FROM OutboxEvent o WHERE o.aggregateId = t.externalReference AND o.processedAt IS NOT NULL)")
    List<Transaction> findPaidWithoutConfirmedMachineStart(@Param("cutoff") LocalDateTime cutoff);
}
