package com.smartlaundromat.payment.repository;

import com.smartlaundromat.payment.model.PaymentEvent;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface PaymentEventRepository extends JpaRepository<PaymentEvent, Long> {

    List<PaymentEvent> findByExternalReferenceOrderByOccurredAtAsc(String externalReference);
}
