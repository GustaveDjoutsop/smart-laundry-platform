package com.smartlaundromat.payment.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.smartlaundromat.payment.config.PaymentConfig;
import com.smartlaundromat.payment.model.PaymentEvent;
import com.smartlaundromat.payment.model.Transaction;
import com.smartlaundromat.payment.model.enums.PaymentStatus;
import com.smartlaundromat.payment.repository.PaymentEventRepository;
import com.smartlaundromat.payment.repository.TransactionRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

@Service
@Slf4j
@RequiredArgsConstructor
public class PaymentTimeoutService {

    private final TransactionRepository transactionRepository;
    private final PaymentEventRepository paymentEventRepository;
    private final PaymentConfig paymentConfig;
    private final ObjectMapper objectMapper;

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
     * Marks one transaction TIMEOUT and appends its ledger event. Deliberately not wrapped
     * in a single transaction spanning the whole {@link #checkTimeouts()} loop — a failure
     * marking one stalled payment must not roll back every other transaction in the same
     * batch run; each row is handled independently, same as before this method existed.
     */
    private void markTimedOut(Transaction transaction) {
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
    }
}
