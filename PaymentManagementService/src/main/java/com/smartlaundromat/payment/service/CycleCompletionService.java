package com.smartlaundromat.payment.service;

import com.smartlaundromat.payment.config.PaymentConfig;
import com.smartlaundromat.payment.model.Transaction;
import com.smartlaundromat.payment.model.enums.PaymentStatus;
import com.smartlaundromat.payment.repository.TransactionRepository;
import com.smartlaundromat.payment.service.notification.BotNotificationClient;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.List;

/**
 * Polls for paid cycles that have just finished and pushes a proactive
 * "cycle completed" WhatsApp notification via {@link BotNotificationClient}.
 * Mirrors {@link CycleReminderService}'s scheduled-sweep style, sharing the
 * same {@code reminderLookbackMinutes} bound to keep the candidate query small.
 *
 * <p>{@code cycleEnd} is computed from {@code cycleStartedAt} (set once when
 * status flips to SUCCESSFUL, never touched again) — not {@code updatedAt},
 * which is refreshed by {@code @PreUpdate} on every save, including this
 * job's own and {@link CycleReminderService}'s bookkeeping writes.
 *
 * <p>If sending fails, {@code completedNotifiedAt} is left null so the next
 * 60s poll retries. Unlike the almost-done reminder, there's no upper bound
 * on the retry window other than the shared lookback — once a candidate falls
 * outside {@code reminderLookbackMinutes}, it naturally stops being retried.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class CycleCompletionService {

    private static final ZoneId DOUALA_ZONE = ZoneId.of("Africa/Douala");
    private static final DateTimeFormatter TIME_FMT = DateTimeFormatter.ofPattern("HH:mm");

    private final TransactionRepository transactionRepository;
    private final PaymentConfig paymentConfig;
    private final BotNotificationClient botNotificationClient;

    @Scheduled(fixedRate = 60000)
    public void checkCompletedCycles() {
        LocalDateTime now = LocalDateTime.now();
        LocalDateTime lookback = now.minusMinutes(paymentConfig.getReminderLookbackMinutes());

        List<Transaction> candidates = transactionRepository
                .findByStatusAndCompletedNotifiedAtIsNullAndUpdatedAtAfter(PaymentStatus.SUCCESSFUL, lookback);

        for (Transaction tx : candidates) {
            if (!StringUtils.hasText(tx.getPhoneNumber()) || tx.getCycleDuration() == null
                    || tx.getCycleStartedAt() == null) {
                continue;
            }

            LocalDateTime cycleEnd = tx.getCycleStartedAt().plusMinutes(tx.getCycleDuration());
            if (now.isBefore(cycleEnd)) {
                continue;
            }

            try {
                String endTime = cycleEnd.atZone(ZoneOffset.UTC)
                        .withZoneSameInstant(DOUALA_ZONE)
                        .format(TIME_FMT);
                botNotificationClient.sendCycleCompleted(tx, endTime);

                try {
                    tx.setCompletedNotifiedAt(now);
                    transactionRepository.save(tx);
                } catch (Exception saveException) {
                    log.error("Sent cycle-completed notification for tx={} but failed to record "
                                    + "completedNotifiedAt — next poll may resend this notification: {}",
                            tx.getExternalReference(), saveException.getMessage());
                }
            } catch (Exception e) {
                log.warn("Failed to send cycle-completed notification for tx={}, will retry next poll: {}",
                        tx.getExternalReference(), e.getMessage());
            }
        }
    }
}
