package com.smartlaundromat.payment.service;

import com.smartlaundromat.payment.model.OutboxEvent;
import com.smartlaundromat.payment.repository.OutboxEventRepository;
import com.smartlaundromat.payment.service.machine.MachineEventPublisher;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * Polls the {@code outbox} table for unprocessed {@code PaymentSucceeded} events
 * and forwards them to MachineStateService via {@link MachineEventPublisher}.
 *
 * <p>Retry policy: exponential backoff (30s × 2^retryCount), max
 * {@value #MAX_RETRIES} attempts. Events that exhaust retries are dead-lettered
 * (next_retry_at set 100 years ahead so the relay ignores them). Query:
 * {@code WHERE processed_at IS NULL AND next_retry_at <= now()}.
 *
 * <p>Single-instance assumption: no SELECT FOR UPDATE SKIP LOCKED. If multiple
 * instances ever run in parallel, the idempotency index on
 * {@code machine_cycles.transaction_reference} in MachineStateService ensures
 * at-most-one cycle is created per payment even with duplicate deliveries.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class OutboxRelayService {

    static final int MAX_RETRIES  = 5;
    private static final int BATCH_SIZE   = 10;
    private static final int BASE_BACKOFF = 30;

    private final OutboxEventRepository outboxRepository;
    private final MachineEventPublisher machineEventPublisher;

    @Scheduled(fixedDelay = 5_000)
    public void processOutbox() {
        List<OutboxEvent> pending = outboxRepository
                .findByProcessedAtIsNullAndNextRetryAtLessThanEqualOrderByCreatedAt(
                        OffsetDateTime.now(), PageRequest.of(0, BATCH_SIZE));

        for (OutboxEvent event : pending) {
            try {
                machineEventPublisher.publish(event);
                event.setProcessedAt(OffsetDateTime.now());
                log.info("Outbox event {} processed (type={}, aggregateId={})",
                        event.getId(), event.getEventType(), event.getAggregateId());
            } catch (Exception e) {
                applyRetryPolicy(event, e);
            }
            outboxRepository.save(event);
        }
    }

    private void applyRetryPolicy(OutboxEvent event, Exception e) {
        int newRetryCount = event.getRetryCount() + 1;
        event.setRetryCount(newRetryCount);
        event.setLastError(truncate(e.getMessage(), 500));

        if (newRetryCount >= MAX_RETRIES) {
            event.setNextRetryAt(OffsetDateTime.now().plusYears(100));
            log.error("DEAD_LETTER outbox event {} after {} attempts (type={}, aggregateId={}): {}",
                    event.getId(), newRetryCount, event.getEventType(), event.getAggregateId(),
                    e.getMessage());
        } else {
            long backoffSeconds = (long) BASE_BACKOFF * (1L << (newRetryCount - 1));
            event.setNextRetryAt(OffsetDateTime.now().plusSeconds(backoffSeconds));
            log.warn("Outbox event {} retry {}/{} in {}s (type={}, aggregateId={}): {}",
                    event.getId(), newRetryCount, MAX_RETRIES, backoffSeconds,
                    event.getEventType(), event.getAggregateId(), e.getMessage());
        }
    }

    private static String truncate(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max);
    }
}
