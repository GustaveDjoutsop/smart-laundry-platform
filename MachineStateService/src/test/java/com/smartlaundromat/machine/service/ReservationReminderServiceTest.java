package com.smartlaundromat.machine.service;

import com.smartlaundromat.machine.config.FeatureProperties;
import com.smartlaundromat.machine.config.ReservationProperties;
import com.smartlaundromat.machine.model.Reservation;
import com.smartlaundromat.machine.model.enums.ReservationStatus;
import com.smartlaundromat.machine.repository.ReservationRepository;
import com.smartlaundromat.machine.service.notification.BotNotificationClient;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class ReservationReminderServiceTest {

    @Mock
    ReservationRepository reservationRepository;

    @Mock
    ReservationProperties reservationProperties;

    @Mock
    FeatureProperties featureProperties;

    @Mock
    BotNotificationClient botNotificationClient;

    @InjectMocks
    ReservationReminderService reservationReminderService;

    private Reservation buildReservation(LocalDateTime slotStart) {
        return Reservation.builder()
                .reservationCode("RES-ABC123")
                .machineId("washer_01")
                .customerPhone("+237600000000")
                .status(ReservationStatus.ACTIVE)
                .slotStart(slotStart)
                .slotEnd(slotStart.plusHours(1))
                .feeAmount(1500)
                .build();
    }

    @Test
    void shouldSkipWhenFeatureDisabled() {
        when(featureProperties.isReservationEnabled()).thenReturn(false);

        reservationReminderService.checkUpcomingReservations();

        verifyNoInteractions(reservationRepository, botNotificationClient);
    }

    @Test
    void shouldSendReminderWhenSlotStartsSoon() {
        when(featureProperties.isReservationEnabled()).thenReturn(true);
        when(reservationProperties.getReminderMinutesBefore()).thenReturn(15);

        // Slot starts in 10 minutes — inside the 15-minute reminder window.
        Reservation reservation = buildReservation(LocalDateTime.now().plusMinutes(10));
        when(reservationRepository.findByStatusAndReminderSentAtIsNullAndSlotStartBefore(
                eq(ReservationStatus.ACTIVE), any(LocalDateTime.class)))
                .thenReturn(List.of(reservation));
        when(reservationRepository.save(any(Reservation.class))).thenAnswer(inv -> inv.getArgument(0));

        reservationReminderService.checkUpcomingReservations();

        verify(botNotificationClient).sendReservationUpcoming(eq(reservation), anyInt(), anyString());
        ArgumentCaptor<Reservation> captor = ArgumentCaptor.forClass(Reservation.class);
        verify(reservationRepository).save(captor.capture());
        assertThat(captor.getValue().getReminderSentAt()).isNotNull();
    }

    @Test
    void shouldFormatSlotEndAsHhMm() {
        when(featureProperties.isReservationEnabled()).thenReturn(true);
        when(reservationProperties.getReminderMinutesBefore()).thenReturn(15);

        Reservation reservation = buildReservation(LocalDateTime.now().plusMinutes(10));
        when(reservationRepository.findByStatusAndReminderSentAtIsNullAndSlotStartBefore(
                eq(ReservationStatus.ACTIVE), any(LocalDateTime.class)))
                .thenReturn(List.of(reservation));
        when(reservationRepository.save(any(Reservation.class))).thenAnswer(inv -> inv.getArgument(0));

        reservationReminderService.checkUpcomingReservations();

        String expectedSlotEnd = reservation.getSlotEnd().format(DateTimeFormatter.ofPattern("HH:mm"));
        verify(botNotificationClient).sendReservationUpcoming(eq(reservation), anyInt(), eq(expectedSlotEnd));
    }

    @Test
    void shouldNotSendReminderWhenSlotAlreadyStarted() {
        when(featureProperties.isReservationEnabled()).thenReturn(true);
        when(reservationProperties.getReminderMinutesBefore()).thenReturn(15);

        // Slot started 2 minutes ago — no longer "upcoming".
        Reservation reservation = buildReservation(LocalDateTime.now().minusMinutes(2));
        when(reservationRepository.findByStatusAndReminderSentAtIsNullAndSlotStartBefore(
                eq(ReservationStatus.ACTIVE), any(LocalDateTime.class)))
                .thenReturn(List.of(reservation));

        reservationReminderService.checkUpcomingReservations();

        verifyNoInteractions(botNotificationClient);
        verify(reservationRepository, never()).save(any());
    }

    @Test
    void shouldDoNothingWhenNoCandidates() {
        when(featureProperties.isReservationEnabled()).thenReturn(true);
        when(reservationProperties.getReminderMinutesBefore()).thenReturn(15);
        when(reservationRepository.findByStatusAndReminderSentAtIsNullAndSlotStartBefore(
                eq(ReservationStatus.ACTIVE), any(LocalDateTime.class)))
                .thenReturn(List.of());

        reservationReminderService.checkUpcomingReservations();

        verifyNoInteractions(botNotificationClient);
        verify(reservationRepository, never()).save(any());
    }

    @Test
    void shouldLeaveReminderSentAtNullWhenNotificationFails() {
        when(featureProperties.isReservationEnabled()).thenReturn(true);
        when(reservationProperties.getReminderMinutesBefore()).thenReturn(15);

        Reservation reservation = buildReservation(LocalDateTime.now().plusMinutes(10));
        when(reservationRepository.findByStatusAndReminderSentAtIsNullAndSlotStartBefore(
                eq(ReservationStatus.ACTIVE), any(LocalDateTime.class)))
                .thenReturn(List.of(reservation));
        doThrow(new RuntimeException("bot service unavailable"))
                .when(botNotificationClient).sendReservationUpcoming(eq(reservation), anyInt(), anyString());

        reservationReminderService.checkUpcomingReservations();

        assertThat(reservation.getReminderSentAt()).isNull();
        verify(reservationRepository, never()).save(any());
    }

    @Test
    void shouldNotPropagateWhenSaveFailsAfterSuccessfulSend() {
        when(featureProperties.isReservationEnabled()).thenReturn(true);
        when(reservationProperties.getReminderMinutesBefore()).thenReturn(15);

        Reservation reservation = buildReservation(LocalDateTime.now().plusMinutes(10));
        when(reservationRepository.findByStatusAndReminderSentAtIsNullAndSlotStartBefore(
                eq(ReservationStatus.ACTIVE), any(LocalDateTime.class)))
                .thenReturn(List.of(reservation));
        when(reservationRepository.save(any(Reservation.class)))
                .thenThrow(new RuntimeException("DB connection lost"));

        // The notification already went out; a save failure here must not throw out
        // of the scheduled method.
        assertThatCode(() -> reservationReminderService.checkUpcomingReservations())
                .doesNotThrowAnyException();

        verify(botNotificationClient).sendReservationUpcoming(eq(reservation), anyInt(), anyString());
        verify(reservationRepository).save(any(Reservation.class));
    }
}
