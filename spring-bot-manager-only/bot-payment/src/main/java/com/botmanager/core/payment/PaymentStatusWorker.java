package com.botmanager.core.payment;

import com.botmanager.config.PaymentProperties;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Slf4j
@Component
@RequiredArgsConstructor
public class PaymentStatusWorker {

    private final PaymentGateway paymentGateway;

    private final PaymentStore paymentStore;

    private final PaymentEventPublisher paymentEventPublisher;

    private final PaymentProperties paymentProperties;

    private final Map<String, Boolean> pollingTasks = new ConcurrentHashMap<>();

    @Async
    @EventListener
    public void onPaymentInitiated(PaymentEventPublisher.PaymentInitiatedEvent event) {
        PaymentRecord record = event.getRecord();
        String taskKey = record.getBotId() + ":" + record.getTransactionId();

        if (pollingTasks.containsKey(taskKey)) {
            log.debug("Already polling for payment {}", record.getTransactionId());
            return;
        }

        pollingTasks.put(taskKey, true);
        log.info("Starting status polling for payment {} via PaymentManagementService", record.getTransactionId());

        long startTime = System.currentTimeMillis();
        long timeout = paymentProperties.getTimeoutMs();
        long pollInterval = paymentProperties.getPollIntervalMs();

        try {
            while (System.currentTimeMillis() - startTime < timeout) {
                if (!pollingTasks.containsKey(taskKey)) {
                    break;
                }

                PaymentStatus status = paymentGateway.checkStatus(
                        record.getBotId(),
                        record.getProvider(),
                        record.getTransactionId()
                );

                if (status != record.getStatus()) {
                    record.setStatus(status);
                    paymentStore.upsertPayment(record);
                    paymentEventPublisher.publishStatusUpdate(record);

                    if (status.isTerminal()) {
                        log.info("Payment {} reached terminal status: {}",
                                record.getTransactionId(), status);
                        break;
                    }
                }

                Thread.sleep(pollInterval);
            }
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            log.warn("Payment polling interrupted for {}", record.getTransactionId());
        } catch (Exception exception) {
            log.error("Payment polling error for {}: {}", record.getTransactionId(), exception.getMessage());
        } finally {
            pollingTasks.remove(taskKey);
        }
    }

    public void stopPolling(String botId, String transactionId) {
        String taskKey = botId + ":" + transactionId;
        pollingTasks.remove(taskKey);
    }

}
