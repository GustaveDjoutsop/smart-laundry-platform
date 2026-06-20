package com.smartlaundromat.machine.service;

import com.smartlaundromat.machine.config.FeatureProperties;
import com.smartlaundromat.machine.config.ReservationProperties;
import com.smartlaundromat.machine.dto.CreateReservationRequest;
import com.smartlaundromat.machine.dto.ReservationResponse;
import com.smartlaundromat.machine.dto.ValidateReservationResponse;
import com.smartlaundromat.machine.exception.MachineNotFoundException;
import com.smartlaundromat.machine.exception.ReservationException;
import com.smartlaundromat.machine.model.Machine;
import com.smartlaundromat.machine.model.Reservation;
import com.smartlaundromat.machine.model.enums.MachineType;
import com.smartlaundromat.machine.model.enums.ReservationStatus;
import com.smartlaundromat.machine.repository.MachineRepository;
import com.smartlaundromat.machine.repository.ReservationRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.util.Collections;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class ReservationServiceTest {

    @Mock
    ReservationRepository reservationRepository;

    @Mock
    MachineRepository machineRepository;

    @Mock
    FeatureProperties featureProperties;

    @Mock
    ReservationProperties reservationProperties;

    @InjectMocks
    ReservationService reservationService;

    private Machine testMachine;

    @BeforeEach
    void setUp() {
        testMachine = Machine.builder()
                .machineId("washer_01")
                .type(MachineType.WASHER)
                .position(1)
                .build();
    }

    // ── isEnabled / requireEnabled ─────────────────────────────────────────────

    @Test
    void shouldReturnTrueWhenFeatureIsEnabled() {
        // given
        when(featureProperties.isReservationEnabled()).thenReturn(true);

        // when
        boolean result = reservationService.isEnabled();

        // then
        assertThat(result).isTrue();
    }

    @Test
    void shouldReturnFalseWhenFeatureIsDisabled() {
        // given
        when(featureProperties.isReservationEnabled()).thenReturn(false);

        // when
        boolean result = reservationService.isEnabled();

        // then
        assertThat(result).isFalse();
    }

    // ── createReservation ──────────────────────────────────────────────────────

    @Nested
    class CreateReservation {

        @Test
        void shouldThrowWhenFeatureDisabled() {
            // given
            when(featureProperties.isReservationEnabled()).thenReturn(false);
            CreateReservationRequest request = new CreateReservationRequest();
            request.setMachineId("washer_01");
            request.setSlotStart(LocalDateTime.now().plusHours(1));

            // when / then
            assertThatThrownBy(() -> reservationService.createReservation(request))
                    .isInstanceOf(ReservationException.class)
                    .hasMessageContaining("disabled");
        }

        @Test
        void shouldThrowWhenMachineNotFound() {
            // given
            when(featureProperties.isReservationEnabled()).thenReturn(true);
            when(machineRepository.findByMachineId("washer_99")).thenReturn(Optional.empty());

            CreateReservationRequest request = new CreateReservationRequest();
            request.setMachineId("washer_99");
            request.setSlotStart(LocalDateTime.now().plusHours(1));

            // when / then
            assertThatThrownBy(() -> reservationService.createReservation(request))
                    .isInstanceOf(MachineNotFoundException.class);
        }

        @Test
        void shouldThrowWhenSlotStartIsNull() {
            // given
            when(featureProperties.isReservationEnabled()).thenReturn(true);
            when(machineRepository.findByMachineId("washer_01")).thenReturn(Optional.of(testMachine));

            CreateReservationRequest request = new CreateReservationRequest();
            request.setMachineId("washer_01");
            request.setSlotStart(null);

            // when / then
            assertThatThrownBy(() -> reservationService.createReservation(request))
                    .isInstanceOf(ReservationException.class)
                    .hasMessageContaining("Slot start is required");
        }

        @Test
        void shouldThrowWhenSlotStartIsInThePast() {
            // given
            when(featureProperties.isReservationEnabled()).thenReturn(true);
            when(machineRepository.findByMachineId("washer_01")).thenReturn(Optional.of(testMachine));

            CreateReservationRequest request = new CreateReservationRequest();
            request.setMachineId("washer_01");
            request.setSlotStart(LocalDateTime.now().minusHours(1));

            // when / then
            assertThatThrownBy(() -> reservationService.createReservation(request))
                    .isInstanceOf(ReservationException.class)
                    .hasMessageContaining("past");
        }

        @Test
        void shouldThrowWhenOverlappingReservationExists() {
            // given
            when(featureProperties.isReservationEnabled()).thenReturn(true);
            when(machineRepository.findByMachineId("washer_01")).thenReturn(Optional.of(testMachine));
            when(reservationRepository.findOverlapping(eq("washer_01"), any(), any()))
                    .thenReturn(List.of(new Reservation()));

            CreateReservationRequest request = new CreateReservationRequest();
            request.setMachineId("washer_01");
            request.setSlotStart(LocalDateTime.now().plusHours(1));

            // when / then
            assertThatThrownBy(() -> reservationService.createReservation(request))
                    .isInstanceOf(ReservationException.class)
                    .hasMessageContaining("already reserved");
        }

        @Test
        void shouldCreateReservationSuccessfully() {
            // given
            when(featureProperties.isReservationEnabled()).thenReturn(true);
            when(machineRepository.findByMachineId("washer_01")).thenReturn(Optional.of(testMachine));
            when(reservationRepository.findOverlapping(eq("washer_01"), any(), any()))
                    .thenReturn(Collections.emptyList());
            when(reservationRepository.existsByReservationCode(anyString())).thenReturn(false);
            when(reservationProperties.getCodePrefix()).thenReturn("RES-");
            when(reservationProperties.getCodeLength()).thenReturn(6);
            when(reservationProperties.getFeeAmount()).thenReturn(1500);
            when(reservationProperties.getCurrency()).thenReturn("XAF");
            when(reservationRepository.save(any(Reservation.class))).thenAnswer(inv -> inv.getArgument(0));

            CreateReservationRequest request = new CreateReservationRequest();
            request.setMachineId("washer_01");
            request.setCustomerPhone("+237612345678");
            request.setSlotStart(LocalDateTime.now().plusHours(1));

            // when
            ReservationResponse response = reservationService.createReservation(request);

            // then
            assertThat(response).isNotNull();
            assertThat(response.getMachineId()).isEqualTo("washer_01");
            assertThat(response.getReservationCode()).startsWith("RES-");
            assertThat(response.getStatus()).isEqualTo(ReservationStatus.PENDING_PAYMENT);
            assertThat(response.getFeeAmount()).isEqualTo(1500);
            assertThat(response.getCurrency()).isEqualTo("XAF");
            assertThat(response.getSlotEnd()).isEqualTo(response.getSlotStart().plusMinutes(60));
            verify(reservationRepository).save(any(Reservation.class));
        }

        @Test
        void shouldThrowWhenUniqueCodeGenerationFails() {
            // given
            when(featureProperties.isReservationEnabled()).thenReturn(true);
            when(machineRepository.findByMachineId("washer_01")).thenReturn(Optional.of(testMachine));
            when(reservationRepository.findOverlapping(eq("washer_01"), any(), any()))
                    .thenReturn(Collections.emptyList());
            when(reservationRepository.existsByReservationCode(anyString())).thenReturn(true);
            when(reservationProperties.getCodePrefix()).thenReturn("RES-");
            when(reservationProperties.getCodeLength()).thenReturn(6);

            CreateReservationRequest request = new CreateReservationRequest();
            request.setMachineId("washer_01");
            request.setSlotStart(LocalDateTime.now().plusHours(1));

            // when / then
            assertThatThrownBy(() -> reservationService.createReservation(request))
                    .isInstanceOf(ReservationException.class)
                    .hasMessageContaining("unique reservation code");
        }
    }

    // ── activateByReference ────────────────────────────────────────────────────

    @Nested
    class ActivateByReference {

        @Test
        void shouldThrowWhenFeatureDisabled() {
            // given
            when(featureProperties.isReservationEnabled()).thenReturn(false);

            // when / then
            assertThatThrownBy(() -> reservationService.activateByReference("REF-123"))
                    .isInstanceOf(ReservationException.class)
                    .hasMessageContaining("disabled");
        }

        @Test
        void shouldThrowWhenReferenceNotFound() {
            // given
            when(featureProperties.isReservationEnabled()).thenReturn(true);
            when(reservationRepository.findByTransactionReference("REF-INVALID"))
                    .thenReturn(Optional.empty());

            // when / then
            assertThatThrownBy(() -> reservationService.activateByReference("REF-INVALID"))
                    .isInstanceOf(ReservationException.class)
                    .hasMessageContaining("No reservation for transaction reference");
        }

        @Test
        void shouldReturnExistingActiveReservation() {
            // given
            when(featureProperties.isReservationEnabled()).thenReturn(true);
            Reservation reservation = Reservation.builder()
                    .reservationCode("RES-ABC123")
                    .machineId("washer_01")
                    .status(ReservationStatus.ACTIVE)
                    .slotStart(LocalDateTime.now())
                    .slotEnd(LocalDateTime.now().plusHours(1))
                    .feeAmount(1500)
                    .currency("XAF")
                    .build();
            when(reservationRepository.findByTransactionReference("REF-123"))
                    .thenReturn(Optional.of(reservation));
            when(machineRepository.findByMachineId("washer_01")).thenReturn(Optional.of(testMachine));

            // when
            ReservationResponse response = reservationService.activateByReference("REF-123");

            // then
            assertThat(response.getStatus()).isEqualTo(ReservationStatus.ACTIVE);
            verify(reservationRepository, never()).save(any());
        }

        @ParameterizedTest
        @EnumSource(value = ReservationStatus.class, names = {"USED", "EXPIRED", "CANCELLED"})
        void shouldThrowWhenStatusIsNotPendingOrActive(ReservationStatus status) {
            // given
            when(featureProperties.isReservationEnabled()).thenReturn(true);
            Reservation reservation = Reservation.builder()
                    .reservationCode("RES-ABC123")
                    .machineId("washer_01")
                    .status(status)
                    .slotStart(LocalDateTime.now())
                    .slotEnd(LocalDateTime.now().plusHours(1))
                    .feeAmount(1500)
                    .build();
            when(reservationRepository.findByTransactionReference("REF-123"))
                    .thenReturn(Optional.of(reservation));

            // when / then
            assertThatThrownBy(() -> reservationService.activateByReference("REF-123"))
                    .isInstanceOf(ReservationException.class)
                    .hasMessageContaining("cannot be activated");
        }

        @Test
        void shouldExpireAndThrowWhenSlotHasEnded() {
            // given
            when(featureProperties.isReservationEnabled()).thenReturn(true);
            Reservation reservation = Reservation.builder()
                    .reservationCode("RES-ABC123")
                    .machineId("washer_01")
                    .status(ReservationStatus.PENDING_PAYMENT)
                    .slotStart(LocalDateTime.now().minusHours(2))
                    .slotEnd(LocalDateTime.now().minusHours(1))
                    .feeAmount(1500)
                    .build();
            when(reservationRepository.findByTransactionReference("REF-123"))
                    .thenReturn(Optional.of(reservation));

            // when / then
            assertThatThrownBy(() -> reservationService.activateByReference("REF-123"))
                    .isInstanceOf(ReservationException.class)
                    .hasMessageContaining("already ended");
            assertThat(reservation.getStatus()).isEqualTo(ReservationStatus.EXPIRED);
            verify(reservationRepository).save(reservation);
        }

        @Test
        void shouldActivateSuccessfully() {
            // given
            when(featureProperties.isReservationEnabled()).thenReturn(true);
            Reservation reservation = Reservation.builder()
                    .reservationCode("RES-ABC123")
                    .machineId("washer_01")
                    .status(ReservationStatus.PENDING_PAYMENT)
                    .slotStart(LocalDateTime.now())
                    .slotEnd(LocalDateTime.now().plusHours(1))
                    .feeAmount(1500)
                    .currency("XAF")
                    .build();
            when(reservationRepository.findByTransactionReference("REF-123"))
                    .thenReturn(Optional.of(reservation));
            when(reservationRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
            when(machineRepository.findByMachineId("washer_01")).thenReturn(Optional.of(testMachine));

            // when
            ReservationResponse response = reservationService.activateByReference("REF-123");

            // then
            assertThat(response.getStatus()).isEqualTo(ReservationStatus.ACTIVE);
            assertThat(reservation.getActivatedAt()).isNotNull();
            verify(reservationRepository).save(reservation);
        }
    }

    // ── validate ───────────────────────────────────────────────────────────────

    @Nested
    class Validate {

        @Test
        void shouldReturnInvalidWhenNotFound() {
            // given
            when(featureProperties.isReservationEnabled()).thenReturn(true);
            when(reservationRepository.findByReservationCodeAndMachineId("CODE", "washer_01"))
                    .thenReturn(Optional.empty());

            // when
            ValidateReservationResponse response = reservationService.validate("CODE", "washer_01");

            // then
            assertThat(response.isValid()).isFalse();
            assertThat(response.getReason()).isEqualTo("NOT_FOUND");
        }

        @Test
        void shouldReturnInvalidWhenStatusUsed() {
            // given
            when(featureProperties.isReservationEnabled()).thenReturn(true);
            Reservation reservation = Reservation.builder()
                    .reservationCode("RES-ABC")
                    .machineId("washer_01")
                    .status(ReservationStatus.USED)
                    .slotStart(LocalDateTime.now())
                    .slotEnd(LocalDateTime.now().plusHours(1))
                    .feeAmount(1500)
                    .build();
            when(reservationRepository.findByReservationCodeAndMachineId("RES-ABC", "washer_01"))
                    .thenReturn(Optional.of(reservation));

            // when
            ValidateReservationResponse response = reservationService.validate("RES-ABC", "washer_01");

            // then
            assertThat(response.isValid()).isFalse();
            assertThat(response.getReason()).isEqualTo("USED");
        }

        @Test
        void shouldReturnInvalidWhenStatusCancelled() {
            // given
            when(featureProperties.isReservationEnabled()).thenReturn(true);
            Reservation reservation = Reservation.builder()
                    .reservationCode("RES-ABC")
                    .machineId("washer_01")
                    .status(ReservationStatus.CANCELLED)
                    .slotStart(LocalDateTime.now())
                    .slotEnd(LocalDateTime.now().plusHours(1))
                    .feeAmount(1500)
                    .build();
            when(reservationRepository.findByReservationCodeAndMachineId("RES-ABC", "washer_01"))
                    .thenReturn(Optional.of(reservation));

            // when
            ValidateReservationResponse response = reservationService.validate("RES-ABC", "washer_01");

            // then
            assertThat(response.isValid()).isFalse();
            assertThat(response.getReason()).isEqualTo("CANCELLED");
        }

        @Test
        void shouldReturnInvalidWhenStatusPending() {
            // given
            when(featureProperties.isReservationEnabled()).thenReturn(true);
            Reservation reservation = Reservation.builder()
                    .reservationCode("RES-ABC")
                    .machineId("washer_01")
                    .status(ReservationStatus.PENDING_PAYMENT)
                    .slotStart(LocalDateTime.now())
                    .slotEnd(LocalDateTime.now().plusHours(1))
                    .feeAmount(1500)
                    .build();
            when(reservationRepository.findByReservationCodeAndMachineId("RES-ABC", "washer_01"))
                    .thenReturn(Optional.of(reservation));

            // when
            ValidateReservationResponse response = reservationService.validate("RES-ABC", "washer_01");

            // then
            assertThat(response.isValid()).isFalse();
            assertThat(response.getReason()).isEqualTo("NOT_ACTIVE");
        }

        @Test
        void shouldReturnInvalidWhenExpired() {
            // given
            when(featureProperties.isReservationEnabled()).thenReturn(true);
            Reservation reservation = Reservation.builder()
                    .reservationCode("RES-ABC")
                    .machineId("washer_01")
                    .status(ReservationStatus.EXPIRED)
                    .slotStart(LocalDateTime.now().minusHours(2))
                    .slotEnd(LocalDateTime.now().minusHours(1))
                    .feeAmount(1500)
                    .build();
            when(reservationRepository.findByReservationCodeAndMachineId("RES-ABC", "washer_01"))
                    .thenReturn(Optional.of(reservation));

            // when
            ValidateReservationResponse response = reservationService.validate("RES-ABC", "washer_01");

            // then
            assertThat(response.isValid()).isFalse();
            assertThat(response.getReason()).isEqualTo("OUT_OF_SLOT");
        }

        @Test
        void shouldReturnValidWhenActiveAndWithinSlot() {
            // given
            when(featureProperties.isReservationEnabled()).thenReturn(true);
            Reservation reservation = Reservation.builder()
                    .reservationCode("RES-ABC")
                    .machineId("washer_01")
                    .status(ReservationStatus.ACTIVE)
                    .slotStart(LocalDateTime.now().minusMinutes(10))
                    .slotEnd(LocalDateTime.now().plusMinutes(50))
                    .feeAmount(1500)
                    .build();
            when(reservationRepository.findByReservationCodeAndMachineId("RES-ABC", "washer_01"))
                    .thenReturn(Optional.of(reservation));

            // when
            ValidateReservationResponse response = reservationService.validate("RES-ABC", "washer_01");

            // then
            assertThat(response.isValid()).isTrue();
            assertThat(response.getReservationCode()).isEqualTo("RES-ABC");
            assertThat(response.getMachineId()).isEqualTo("washer_01");
        }
    }

    // ── validateAndConsume ─────────────────────────────────────────────────────

    @Nested
    class ValidateAndConsume {

        @Test
        void shouldThrowWhenCodeNotFound() {
            // given
            when(featureProperties.isReservationEnabled()).thenReturn(true);
            when(reservationRepository.findByReservationCodeAndMachineId("BAD", "washer_01"))
                    .thenReturn(Optional.empty());

            // when / then
            assertThatThrownBy(() -> reservationService.validateAndConsume("BAD", "washer_01"))
                    .isInstanceOf(ReservationException.class)
                    .hasMessageContaining("No reservation with that code");
        }

        @Test
        void shouldThrowWhenReservationNotUsable() {
            // given
            when(featureProperties.isReservationEnabled()).thenReturn(true);
            Reservation reservation = Reservation.builder()
                    .reservationCode("RES-ABC")
                    .machineId("washer_01")
                    .status(ReservationStatus.USED)
                    .slotStart(LocalDateTime.now())
                    .slotEnd(LocalDateTime.now().plusHours(1))
                    .feeAmount(1500)
                    .build();
            when(reservationRepository.findByReservationCodeAndMachineId("RES-ABC", "washer_01"))
                    .thenReturn(Optional.of(reservation));

            // when / then
            assertThatThrownBy(() -> reservationService.validateAndConsume("RES-ABC", "washer_01"))
                    .isInstanceOf(ReservationException.class)
                    .hasMessageContaining("not usable");
        }

        @Test
        void shouldConsumeValidReservation() {
            // given
            when(featureProperties.isReservationEnabled()).thenReturn(true);
            Reservation reservation = Reservation.builder()
                    .reservationCode("RES-ABC")
                    .machineId("washer_01")
                    .status(ReservationStatus.ACTIVE)
                    .slotStart(LocalDateTime.now().minusMinutes(10))
                    .slotEnd(LocalDateTime.now().plusMinutes(50))
                    .feeAmount(1500)
                    .build();
            when(reservationRepository.findByReservationCodeAndMachineId("RES-ABC", "washer_01"))
                    .thenReturn(Optional.of(reservation));
            when(reservationRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

            // when
            Reservation result = reservationService.validateAndConsume("RES-ABC", "washer_01");

            // then
            assertThat(result.getStatus()).isEqualTo(ReservationStatus.USED);
            assertThat(result.getUsedAt()).isNotNull();
            verify(reservationRepository).save(reservation);
        }
    }

    // ── activeReservationCovering ──────────────────────────────────────────────

    @Test
    void shouldReturnEmptyWhenFeatureDisabled() {
        // given
        when(featureProperties.isReservationEnabled()).thenReturn(false);

        // when
        Optional<Reservation> result = reservationService.activeReservationCovering("washer_01");

        // then
        assertThat(result).isEmpty();
    }

    @Test
    void shouldDelegateToRepositoryWhenEnabled() {
        // given
        when(featureProperties.isReservationEnabled()).thenReturn(true);
        Reservation reservation = Reservation.builder()
                .reservationCode("RES-ABC")
                .machineId("washer_01")
                .status(ReservationStatus.ACTIVE)
                .feeAmount(1500)
                .build();
        when(reservationRepository.findActiveCovering(eq("washer_01"), any()))
                .thenReturn(Optional.of(reservation));

        // when
        Optional<Reservation> result = reservationService.activeReservationCovering("washer_01");

        // then
        assertThat(result).isPresent();
        assertThat(result.get().getReservationCode()).isEqualTo("RES-ABC");
    }

    // ── getByCode ──────────────────────────────────────────────────────────────

    @Test
    void shouldReturnReservationByCode() {
        // given
        when(featureProperties.isReservationEnabled()).thenReturn(true);
        Reservation reservation = Reservation.builder()
                .reservationCode("RES-ABC")
                .machineId("washer_01")
                .status(ReservationStatus.ACTIVE)
                .slotStart(LocalDateTime.now())
                .slotEnd(LocalDateTime.now().plusHours(1))
                .feeAmount(1500)
                .currency("XAF")
                .build();
        when(reservationRepository.findByReservationCode("RES-ABC"))
                .thenReturn(Optional.of(reservation));
        when(machineRepository.findByMachineId("washer_01")).thenReturn(Optional.of(testMachine));

        // when
        ReservationResponse response = reservationService.getByCode("RES-ABC");

        // then
        assertThat(response.getReservationCode()).isEqualTo("RES-ABC");
    }

    @Test
    void shouldThrowWhenCodeNotFoundInGetByCode() {
        // given
        when(featureProperties.isReservationEnabled()).thenReturn(true);
        when(reservationRepository.findByReservationCode("BAD"))
                .thenReturn(Optional.empty());

        // when / then
        assertThatThrownBy(() -> reservationService.getByCode("BAD"))
                .isInstanceOf(ReservationException.class)
                .hasMessageContaining("not found");
    }

    // ── listForMachine ─────────────────────────────────────────────────────────

    @Test
    void shouldListReservationsForMachine() {
        // given
        when(reservationRepository.findByMachineIdOrderBySlotStartDesc("washer_01"))
                .thenReturn(List.of(new Reservation()));

        // when
        List<Reservation> result = reservationService.listForMachine("washer_01");

        // then
        assertThat(result).hasSize(1);
    }

    // ── expireOverdue ──────────────────────────────────────────────────────────

    @Test
    void shouldSkipExpiryWhenFeatureDisabled() {
        // given
        when(featureProperties.isReservationEnabled()).thenReturn(false);

        // when
        reservationService.expireOverdue();

        // then
        verify(reservationRepository, never()).findExpirable(any());
    }

    @Test
    void shouldExpireOverdueReservations() {
        // given
        when(featureProperties.isReservationEnabled()).thenReturn(true);
        Reservation r1 = Reservation.builder()
                .reservationCode("RES-1")
                .machineId("washer_01")
                .status(ReservationStatus.ACTIVE)
                .feeAmount(1500)
                .build();
        Reservation r2 = Reservation.builder()
                .reservationCode("RES-2")
                .machineId("washer_02")
                .status(ReservationStatus.PENDING_PAYMENT)
                .feeAmount(1500)
                .build();
        when(reservationRepository.findExpirable(any())).thenReturn(List.of(r1, r2));

        // when
        reservationService.expireOverdue();

        // then
        assertThat(r1.getStatus()).isEqualTo(ReservationStatus.EXPIRED);
        assertThat(r2.getStatus()).isEqualTo(ReservationStatus.EXPIRED);
        verify(reservationRepository).saveAll(List.of(r1, r2));
    }

    @Test
    void shouldDoNothingWhenNoExpirableReservations() {
        // given
        when(featureProperties.isReservationEnabled()).thenReturn(true);
        when(reservationRepository.findExpirable(any())).thenReturn(Collections.emptyList());

        // when
        reservationService.expireOverdue();

        // then
        verify(reservationRepository, never()).saveAll(any());
    }
}
