package com.botmanager.core.payment;

import lombok.Getter;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

@Slf4j
@Component
@RequiredArgsConstructor
public class PaymentEventPublisher {

    private final ApplicationEventPublisher applicationEventPublisher;

    public void publishInitiated(PaymentRecord record) {
        log.debug("Publishing payment.initiated for {}", record.getTransactionId());
        applicationEventPublisher.publishEvent(new PaymentInitiatedEvent(record));
    }

    public void publishStatusUpdate(PaymentRecord record) {
        log.debug("Publishing payment.status for {} with status {}", record.getTransactionId(), record.getStatus());
        applicationEventPublisher.publishEvent(new PaymentStatusEvent(record));

        if (record.getStatus() == PaymentStatus.COMPLETED) {
            applicationEventPublisher.publishEvent(new PaymentCompletedEvent(record));
        } else if (record.getStatus() == PaymentStatus.FAILED) {
            applicationEventPublisher.publishEvent(new PaymentFailedEvent(record));
        }
    }

    @Getter
    public static class PaymentInitiatedEvent {

        private final PaymentRecord record;

        public PaymentInitiatedEvent(PaymentRecord record) {
            this.record = record;
        }
    }

    @Getter
    public static class PaymentStatusEvent {

        private final PaymentRecord record;

        public PaymentStatusEvent(PaymentRecord record) {
            this.record = record;
        }
    }

    @Getter
    public static class PaymentCompletedEvent {

        private final PaymentRecord record;

        public PaymentCompletedEvent(PaymentRecord record) {
            this.record = record;
        }
    }

    @Getter
    public static class PaymentFailedEvent {

        private final PaymentRecord record;

        public PaymentFailedEvent(PaymentRecord record) {
            this.record = record;
        }
    }

}
