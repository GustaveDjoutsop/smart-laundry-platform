package com.botmanager.core.persistence.repository;

import com.botmanager.core.persistence.entity.PaymentEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface PaymentRepository extends JpaRepository<PaymentEntity, UUID> {

    Optional<PaymentEntity> findByTransactionId(String transactionId);

    Optional<PaymentEntity> findByExternalRef(String externalRef);
}
