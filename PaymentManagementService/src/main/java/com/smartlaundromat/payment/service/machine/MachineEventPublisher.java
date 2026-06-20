package com.smartlaundromat.payment.service.machine;

import com.smartlaundromat.payment.model.OutboxEvent;

/**
 * Transport-agnostic interface for publishing machine-related domain events
 * from the {@code outbox} table.
 *
 * <p>Current implementation: {@link MachineStartService} (HTTP POST to
 * MachineStateService). Future: swap for a Kafka/RabbitMQ publisher without
 * touching {@link com.smartlaundromat.payment.service.OutboxRelayService}.
 */
public interface MachineEventPublisher {

    /**
     * Publishes the given outbox event to MachineStateService (or a message
     * broker). Throws on transient failure — the relay will retry. Implementations
     * must be idempotent-safe: the relay may call this more than once for the same
     * event if a previous attempt succeeded but the processed_at update failed.
     */
    void publish(OutboxEvent event) throws Exception;
}
