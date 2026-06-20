package com.smartlaundromat.payment.repository;

import com.smartlaundromat.payment.model.OutboxEvent;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.time.OffsetDateTime;
import java.util.List;

@Repository
public interface OutboxEventRepository extends JpaRepository<OutboxEvent, Long> {

    List<OutboxEvent> findByProcessedAtIsNullAndNextRetryAtLessThanEqualOrderByCreatedAt(
            OffsetDateTime now, Pageable pageable);
}
