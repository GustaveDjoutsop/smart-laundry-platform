package com.smartlaundromat.payment.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.smartlaundromat.payment.config.PaymentConfig;
import com.smartlaundromat.payment.model.PaymentEvent;
import com.smartlaundromat.payment.model.Transaction;
import com.smartlaundromat.payment.model.enums.PaymentStatus;
import com.smartlaundromat.payment.repository.PaymentEventRepository;
import com.smartlaundromat.payment.repository.TransactionRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

@Service
@Slf4j
public class PaymentTimeoutService {

    private final TransactionRepository transactionRepository;
    private final PaymentEventRepository paymentEventRepository;
    private final PaymentConfig paymentConfig;
    private final ObjectMapper objectMapper;
    private final TransactionTemplate transactionTemplate;

    public PaymentTimeoutService(TransactionRepository transactionRepository,
                                  PaymentEventRepository paymentEventRepository,
                                  PaymentConfig paymentConfig,
                                  ObjectMapper objectMapper,
                                  PlatformTransactionManager transactionManager) {
        this.transactionRepository = transactionRepository;
        this.paymentEventRepository = paymentEventRepository;
        this.paymentConfig = paymentConfig;
        this.objectMapper = objectMapper;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
    }

    @Scheduled(fixedRate = 60000)
    public void checkTimeouts() {
        LocalDateTime cutoff = LocalDateTime.now().minusMinutes(paymentConfig.getTimeoutMinutes());

        List<Transaction> timedOut = transactionRepository
                .findByStatusAndCreatedAtBefore(PaymentStatus.PENDING, cutoff);

        for (Transaction transaction : timedOut) {
            markTimedOut(transaction);

            log.info("Payment timed out: ref={}, machine={}",
                    transaction.getExternalReference(), transaction.getMachineId());
        }

        if (!timedOut.isEmpty()) {
            log.info("Marked {} payments as TIMEOUT", timedOut.size());
        }
    }

    /**
     * Marks one transaction TIMEOUT and appends its ledger event, atomically as a pair —
     * via a programmatic {@link TransactionTemplate} rather than {@code @Transactional},
     * since a private method called via self-invocation from {@link #checkTimeouts()}
     * would never actually be proxied by Spring AOP and the annotation would be silently
     * ignored. Deliberately scoped to its own transaction per call, not the whole
     * {@link #checkTimeouts()} loop — a failure marking one stalled payment must not roll
     * back every other transaction in the same batch run; unprocessed rows are simply
     * picked up again on the next scheduled run.
     */
    private void markTimedOut(Transaction transaction) {
        transactionTemplate.executeWithoutResult(status -> {
            transaction.setStatus(PaymentStatus.TIMEOUT);
            transaction.setTimeoutAt(LocalDateTime.now());
            transactionRepository.save(transaction);

            try {
                PaymentEvent event = PaymentEvent.builder()
                        .transactionId(transaction.getId())
                        .externalReference(transaction.getExternalReference())
                        .eventType(PaymentStatus.TIMEOUT)
                        .rawPayload(objectMapper.writeValueAsString(Map.of("machineId", transaction.getMachineId())))
                        .build();
                paymentEventRepository.save(event);
            } catch (JsonProcessingException e) {
                throw new IllegalStateException(
                        "Cannot serialize payment event payload for tx " + transaction.getExternalReference(), e);
            }
        });
    }
}
