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

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.List;

/**
 * Polls for paid cycles a few minutes from finishing and pushes a proactive
 * "almost done" WhatsApp reminder via {@link BotNotificationClient}. Mirrors
 * {@link PaymentTimeoutService}'s scheduled-sweep style.
 *
 * <p>The candidate query is bounded by {@code updatedAt} (reminderLookbackMinutes,
 * comfortably above the longest cycle duration) to avoid scanning the whole
 * transactions table. If sending fails, {@code reminderSentAt} is left null so
 * the next 60s poll retries — naturally bounded by the reminder window itself
 * (reminderMinutesBefore..cycleEnd), no extra retry infrastructure needed.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class CycleReminderService {

    private final TransactionRepository transactionRepository;
    private final PaymentConfig paymentConfig;
    private final BotNotificationClient botNotificationClient;

    @Scheduled(fixedRate = 60000)
    public void checkAlmostDoneCycles() {
        LocalDateTime now = LocalDateTime.now();
        LocalDateTime lookback = now.minusMinutes(paymentConfig.getReminderLookbackMinutes());

        List<Transaction> candidates = transactionRepository
                .findByStatusAndReminderSentAtIsNullAndUpdatedAtAfter(PaymentStatus.SUCCESSFUL, lookback);

        for (Transaction tx : candidates) {
            if (tx.getPhoneNumber() == null || tx.getCycleDuration() == null) {
                continue;
            }

            LocalDateTime cycleEnd = tx.getUpdatedAt().plusMinutes(tx.getCycleDuration());
            LocalDateTime reminderAt = cycleEnd.minusMinutes(paymentConfig.getReminderMinutesBefore());

            if (now.isBefore(reminderAt) || !now.isBefore(cycleEnd)) {
                continue;
            }

            try {
                int minutesLeft = (int) Duration.between(now, cycleEnd).toMinutes();
                botNotificationClient.sendCycleAlmostDone(tx, minutesLeft);
                tx.setReminderSentAt(now);
                transactionRepository.save(tx);
            } catch (Exception e) {
                log.warn("Failed to send almost-done reminder for tx={}, will retry next poll: {}",
                        tx.getExternalReference(), e.getMessage());
            }
        }
    }
}
