package com.smartlaundromat.payment.repository;

import com.smartlaundromat.payment.model.Transaction;
import com.smartlaundromat.payment.model.enums.PaymentStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Repository
public interface TransactionRepository extends JpaRepository<Transaction, Long> {

    Optional<Transaction> findByExternalReference(String externalReference);

    List<Transaction> findByMachineIdAndStatus(String machineId, PaymentStatus status);

    List<Transaction> findByStatusAndCreatedAtBefore(PaymentStatus status, LocalDateTime before);

    List<Transaction> findByRfidCardUidOrderByCreatedAtDesc(String rfidCardUid);

    List<Transaction> findByMachineIdOrderByCreatedAtDesc(String machineId);
}
