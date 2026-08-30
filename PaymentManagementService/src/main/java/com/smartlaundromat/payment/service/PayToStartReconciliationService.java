package com.smartlaundromat.payment.service;

import com.smartlaundromat.payment.model.Transaction;
import com.smartlaundromat.payment.repository.TransactionRepository;
import io.micrometer.core.instrument.MeterRegistry;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;

/**
 * R4 reconciliation job: periodically checks for payments that reached
 * {@code SUCCESSFUL} but have no outbox-confirmed machine start after a
 * generous grace period, and exposes the count as a gauge so
 * {@code PaidTransactionsWithoutMachineStart} (see {@code monitoring/prometheus/alerts.yml})
 * can page on it.
 *
 * <p>This complements the existing {@code OutboxDeadLetter}/{@code OutboxPendingHigh}
 * alerts, which watch the outbox table itself: this job instead watches the business
 * outcome directly (a customer who paid and whose machine never started), so it also
 * catches the edge case of an outbox row never having been written in the first place.
 */
@Service
@Slf4j
public class PayToStartReconciliationService {

    /**
     * Grace period before a stuck payment is reported. Comfortably larger than the
     * outbox relay's worst-case retry window ({@value OutboxRelayService#MAX_RETRIES}
     * attempts, exponential backoff up to a few minutes), so transient
     * MachineStateService downtime alone does not trigger a false alert.
     */
    static final int GRACE_PERIOD_MINUTES = 15;

    private final TransactionRepository transactionRepository;
    private final AtomicInteger orphanedTransactionCount = new AtomicInteger(0);

    public PayToStartReconciliationService(TransactionRepository transactionRepository, MeterRegistry registry) {
        this.transactionRepository = transactionRepository;

        registry.gauge("payment.reconciliation.orphaned_transactions", orphanedTransactionCount);
    }

    @Scheduled(fixedRate = 300_000)
    public void reconcile() {
        LocalDateTime cutoff = LocalDateTime.now().minusMinutes(GRACE_PERIOD_MINUTES);

        List<Transaction> orphaned = transactionRepository.findPaidWithoutConfirmedMachineStart(cutoff);
        orphanedTransactionCount.set(orphaned.size());

        if (!orphaned.isEmpty()) {
            log.error("Found {} paid transaction(s) with no confirmed machine start after {} minutes: {}",
                    orphaned.size(), GRACE_PERIOD_MINUTES, describe(orphaned));
        }
    }

    private static String describe(List<Transaction> orphaned) {
        return orphaned.stream()
                .map(t -> t.getExternalReference() + "/machine=" + t.getMachineId())
                .collect(Collectors.joining(", "));
    }
}
