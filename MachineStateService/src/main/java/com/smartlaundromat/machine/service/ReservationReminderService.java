package com.smartlaundromat.machine.service;

import com.smartlaundromat.machine.config.FeatureProperties;
import com.smartlaundromat.machine.config.ReservationProperties;
import com.smartlaundromat.machine.model.Reservation;
import com.smartlaundromat.machine.model.enums.ReservationStatus;
import com.smartlaundromat.machine.repository.ReservationRepository;
import com.smartlaundromat.machine.service.notification.BotNotificationClient;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.List;

/**
 * Polls for ACTIVE reservations whose slot starts soon and pushes a proactive
 * "your reservation starts soon" WhatsApp reminder via {@link BotNotificationClient}.
 * Mirrors PaymentManagementService's {@code CycleReminderService} scheduled-sweep
 * style — distinct from that mid-cycle "almost done" reminder, this is a pre-slot
 * reminder for reservations specifically.
 *
 * <p>If sending fails, {@code reminderSentAt} is left null so the next poll retries,
 * naturally bounded by the reminder window itself (now..slotStart) — once slotStart
 * passes, the candidate query in {@link #checkUpcomingReservations()} stops
 * returning the row entirely (see the {@code isAfter(now)} guard), so a
 * never-successfully-sent reminder simply stops being attempted rather than
 * spamming a "reminder" for a slot that already started.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class ReservationReminderService {

    private final ReservationRepository reservationRepository;
    private final ReservationProperties reservationProperties;
    private final FeatureProperties featureProperties;
    private final BotNotificationClient botNotificationClient;

    @Scheduled(fixedRate = 60000)
    public void checkUpcomingReservations() {
        if (!featureProperties.isReservationEnabled()) return;

        LocalDateTime now = LocalDateTime.now();
        LocalDateTime cutoff = now.plusMinutes(reservationProperties.getReminderMinutesBefore());

        List<Reservation> candidates = reservationRepository
                .findByStatusAndReminderSentAtIsNullAndSlotStartBefore(ReservationStatus.ACTIVE, cutoff);

        for (Reservation reservation : candidates) {
            if (!reservation.getSlotStart().isAfter(now)) {
                // Slot already started/passed — no longer "upcoming"; skip rather than
                // send a stale reminder.
                continue;
            }

            try {
                int minutesBefore = (int) Duration.between(now, reservation.getSlotStart()).toMinutes();
                botNotificationClient.sendReservationUpcoming(reservation, minutesBefore);

                try {
                    reservation.setReminderSentAt(now);
                    reservationRepository.save(reservation);
                } catch (Exception saveException) {
                    log.error("Sent upcoming-reservation reminder for code={} but failed to record "
                                    + "reminderSentAt — next poll may resend this notification: {}",
                            reservation.getReservationCode(), saveException.getMessage());
                }
            } catch (Exception e) {
                log.warn("Failed to send upcoming-reservation reminder for code={}, will retry next poll: {}",
                        reservation.getReservationCode(), e.getMessage());
            }
        }
    }
}
