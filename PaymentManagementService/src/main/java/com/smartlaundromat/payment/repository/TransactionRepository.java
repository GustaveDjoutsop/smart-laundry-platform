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
}
