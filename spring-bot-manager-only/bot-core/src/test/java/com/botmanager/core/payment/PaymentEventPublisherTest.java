package com.botmanager.core.payment;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEventPublisher;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class PaymentEventPublisherTest {

    @Mock
    private ApplicationEventPublisher applicationEventPublisher;

    private PaymentEventPublisher paymentEventPublisher;

    @BeforeEach
    void setUp() {
        paymentEventPublisher = new PaymentEventPublisher(applicationEventPublisher);
    }

    @Test
    void shouldPublishInitiatedEvent() {
        // given
        PaymentRecord record = createRecord(PaymentStatus.PENDING);

        // when
        paymentEventPublisher.publishInitiated(record);

        // then
        ArgumentCaptor<PaymentEventPublisher.PaymentInitiatedEvent> captor =
                ArgumentCaptor.forClass(PaymentEventPublisher.PaymentInitiatedEvent.class);
        verify(applicationEventPublisher).publishEvent(captor.capture());
        assertThat(captor.getValue().getRecord()).isSameAs(record);
    }

    @Test
    void shouldPublishStatusUpdateAndCompletedEventWhenCompleted() {
        // given
        PaymentRecord record = createRecord(PaymentStatus.COMPLETED);

        // when
        paymentEventPublisher.publishStatusUpdate(record);

        // then
        ArgumentCaptor<Object> captor = ArgumentCaptor.forClass(Object.class);
        verify(applicationEventPublisher, times(2)).publishEvent(captor.capture());

        assertThat(captor.getAllValues().get(0)).isInstanceOf(PaymentEventPublisher.PaymentStatusEvent.class);
        assertThat(captor.getAllValues().get(1)).isInstanceOf(PaymentEventPublisher.PaymentCompletedEvent.class);
    }

    @Test
    void shouldPublishStatusUpdateAndFailedEventWhenFailed() {
        // given
        PaymentRecord record = createRecord(PaymentStatus.FAILED);

        // when
        paymentEventPublisher.publishStatusUpdate(record);

        // then
        ArgumentCaptor<Object> captor = ArgumentCaptor.forClass(Object.class);
        verify(applicationEventPublisher, times(2)).publishEvent(captor.capture());

        assertThat(captor.getAllValues().get(0)).isInstanceOf(PaymentEventPublisher.PaymentStatusEvent.class);
        assertThat(captor.getAllValues().get(1)).isInstanceOf(PaymentEventPublisher.PaymentFailedEvent.class);
    }

    @Test
    void shouldPublishOnlyStatusEventWhenPending() {
        // given
        PaymentRecord record = createRecord(PaymentStatus.PENDING);

        // when
        paymentEventPublisher.publishStatusUpdate(record);

        // then
        verify(applicationEventPublisher, times(1)).publishEvent(any(Object.class));
    }

    @Test
    void shouldPublishOnlyStatusEventWhenProcessing() {
        // given
        PaymentRecord record = createRecord(PaymentStatus.PROCESSING);

        // when
        paymentEventPublisher.publishStatusUpdate(record);

        // then
        verify(applicationEventPublisher, times(1)).publishEvent(any(Object.class));
    }

    @Test
    void shouldPreserveRecordInCompletedEvent() {
        // given
        PaymentRecord record = createRecord(PaymentStatus.COMPLETED);

        // when
        paymentEventPublisher.publishStatusUpdate(record);

        // then
        ArgumentCaptor<Object> captor = ArgumentCaptor.forClass(Object.class);
        verify(applicationEventPublisher, times(2)).publishEvent(captor.capture());

        PaymentEventPublisher.PaymentCompletedEvent completedEvent =
                (PaymentEventPublisher.PaymentCompletedEvent) captor.getAllValues().get(1);
        assertThat(completedEvent.getRecord()).isSameAs(record);
    }

    @Test
    void shouldPreserveRecordInFailedEvent() {
        // given
        PaymentRecord record = createRecord(PaymentStatus.FAILED);

        // when
        paymentEventPublisher.publishStatusUpdate(record);

        // then
        ArgumentCaptor<Object> captor = ArgumentCaptor.forClass(Object.class);
        verify(applicationEventPublisher, times(2)).publishEvent(captor.capture());

        PaymentEventPublisher.PaymentFailedEvent failedEvent =
                (PaymentEventPublisher.PaymentFailedEvent) captor.getAllValues().get(1);
        assertThat(failedEvent.getRecord()).isSameAs(record);
    }

    private PaymentRecord createRecord(PaymentStatus status) {
        return PaymentRecord.builder()
                .botId("test-bot")
                .transactionId("txn-123")
                .customerPhone("+237690000000")
                .amount(500)
                .currency("XAF")
                .status(status)
                .createdAt(Instant.now())
                .build();
    }

}
