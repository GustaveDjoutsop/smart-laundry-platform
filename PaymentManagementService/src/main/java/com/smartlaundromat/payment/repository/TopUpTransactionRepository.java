package com.smartlaundromat.payment.repository;

import com.smartlaundromat.payment.model.TopUpTransaction;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface TopUpTransactionRepository extends JpaRepository<TopUpTransaction, Long> {

    Optional<TopUpTransaction> findByReference(String reference);

    List<TopUpTransaction> findByRfidCardUidOrderByCreatedAtDesc(String rfidCardUid);
}
