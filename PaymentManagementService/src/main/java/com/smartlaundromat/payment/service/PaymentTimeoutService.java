package com.smartlaundromat.payment.service;

import com.smartlaundromat.payment.config.PaymentConfig;
import com.smartlaundromat.payment.model.Transaction;
import com.smartlaundromat.payment.model.enums.PaymentStatus;
import com.smartlaundromat.payment.repository.TransactionRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;

@Service
@Slf4j
@RequiredArgsConstructor
public class PaymentTimeoutService {

    private final TransactionRepository transactionRepository;
    private final PaymentConfig paymentConfig;

    @Scheduled(fixedRate = 60000)
    public void checkTimeouts() {
        LocalDateTime cutoff = LocalDateTime.now().minusMinutes(paymentConfig.getTimeoutMinutes());

        List<Transaction> timedOut = transactionRepository
                .findByStatusAndCreatedAtBefore(PaymentStatus.PENDING, cutoff);

        for (Transaction transaction : timedOut) {
            transaction.setStatus(PaymentStatus.TIMEOUT);
            transaction.setTimeoutAt(LocalDateTime.now());
            transactionRepository.save(transaction);

            log.info("Payment timed out: ref={}, machine={}",
                    transaction.getExternalReference(), transaction.getMachineId());
        }

        if (!timedOut.isEmpty()) {
            log.info("Marked {} payments as TIMEOUT", timedOut.size());
        }
    }
}
