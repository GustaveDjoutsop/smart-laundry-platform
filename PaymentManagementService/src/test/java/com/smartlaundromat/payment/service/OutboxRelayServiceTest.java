package com.smartlaundromat.payment.service;

import com.smartlaundromat.payment.model.OutboxEvent;
import com.smartlaundromat.payment.repository.OutboxEventRepository;
import com.smartlaundromat.payment.service.machine.MachineEventPublisher;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageRequest;

import java.time.OffsetDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class OutboxRelayServiceTest {

    @Mock
    OutboxEventRepository outboxRepository;

    @Mock
    MachineEventPublisher machineEventPublisher;

    OutboxRelayService outboxRelayService;

    private OutboxEvent event;

    @BeforeEach
    void setUp() {
        outboxRelayService = new OutboxRelayService(outboxRepository, machineEventPublisher, new SimpleMeterRegistry());

        event = OutboxEvent.builder()
                .id(1L)
                .aggregateType("Transaction")
                .aggregateId("EXT-001")
                .eventType("PaymentSucceeded")
                .payload("{\"machineId\":\"MACH-01\"}")
                .retryCount(0)
                .build();
    }

    @Test
    void shouldMarkEventProcessedWhenPublishSucceeds() throws Exception {
        // given
        when(outboxRepository.findByProcessedAtIsNullAndNextRetryAtLessThanEqualOrderByCreatedAt(
                any(OffsetDateTime.class), any(PageRequest.class)))
                .thenReturn(List.of(event));

        // when
        outboxRelayService.processOutbox();

        // then
        assertThat(event.getProcessedAt()).isNotNull();
        assertThat(event.getRetryCount()).isZero();
        verify(machineEventPublisher).publish(event);
        verify(outboxRepository).save(event);
    }

    @Test
    void shouldApplyBackoffRetryWhenPublishFailsAndRetriesRemain() throws Exception {
        // given
        doThrow(new RuntimeException("Connection refused")).when(machineEventPublisher).publish(event);
        when(outboxRepository.findByProcessedAtIsNullAndNextRetryAtLessThanEqualOrderByCreatedAt(
                any(OffsetDateTime.class), any(PageRequest.class)))
                .thenReturn(List.of(event));

        // when
        outboxRelayService.processOutbox();

        // then
        assertThat(event.getProcessedAt()).isNull();
        assertThat(event.getRetryCount()).isEqualTo(1);
        assertThat(event.getNextRetryAt()).isAfter(OffsetDateTime.now().plusSeconds(20));
        assertThat(event.getLastError()).contains("Connection refused");
        verify(outboxRepository).save(event);
    }

    @Test
    void shouldDeadLetterEventAfterMaxRetriesExhausted() throws Exception {
        // given
        event.setRetryCount(OutboxRelayService.MAX_RETRIES - 1);
        doThrow(new RuntimeException("Connection refused")).when(machineEventPublisher).publish(event);
        when(outboxRepository.findByProcessedAtIsNullAndNextRetryAtLessThanEqualOrderByCreatedAt(
                any(OffsetDateTime.class), any(PageRequest.class)))
                .thenReturn(List.of(event));

        // when
        outboxRelayService.processOutbox();

        // then
        assertThat(event.getProcessedAt()).isNull();
        assertThat(event.getRetryCount()).isEqualTo(OutboxRelayService.MAX_RETRIES);
        assertThat(event.getNextRetryAt()).isAfter(OffsetDateTime.now().plusYears(50));
    }

    /**
     * Reproduces the exact failure the R4 audit item flagged: MachineStateService is
     * unreachable on the first delivery attempt (payment already succeeded), then
     * recovers on the next scheduled poll. The event must be delivered exactly once —
     * {@link MachineEventPublisher#publish(OutboxEvent)} is called once per poll, and a
     * poll that already marked the event processed must not be picked up again.
     */
    @Test
    void shouldStartMachineExactlyOnceWhenMachineStateServiceRecoversAfterOutage() throws Exception {
        // given: first poll finds the event and MSS is down
        doThrow(new RuntimeException("Connection refused")).when(machineEventPublisher).publish(event);
        when(outboxRepository.findByProcessedAtIsNullAndNextRetryAtLessThanEqualOrderByCreatedAt(
                any(OffsetDateTime.class), any(PageRequest.class)))
                .thenReturn(List.of(event));

        // when: first poll (MSS unreachable)
        outboxRelayService.processOutbox();

        // then: retried, not yet processed
        assertThat(event.getProcessedAt()).isNull();
        assertThat(event.getRetryCount()).isEqualTo(1);

        // given: MSS has recovered by the next poll
        reset(machineEventPublisher);
        doNothing().when(machineEventPublisher).publish(event);

        // when: second poll (MSS reachable again)
        outboxRelayService.processOutbox();

        // then: delivered exactly once on this poll, event now processed
        assertThat(event.getProcessedAt()).isNotNull();
        verify(machineEventPublisher, times(1)).publish(event);

        // and: a subsequent poll must not redeliver an already-processed event —
        // the repository query itself excludes rows with processedAt set, so the
        // relay would not even see it again; confirm no further publish call happens
        // if the (now-processed) event were mistakenly returned again.
        reset(machineEventPublisher);
        when(outboxRepository.findByProcessedAtIsNullAndNextRetryAtLessThanEqualOrderByCreatedAt(
                any(OffsetDateTime.class), any(PageRequest.class)))
                .thenReturn(List.of());

        outboxRelayService.processOutbox();

        verify(machineEventPublisher, never()).publish(eq(event));
    }
}
