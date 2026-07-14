package com.smartlaundromat.machine.service;

import com.smartlaundromat.machine.config.MachineConfig;
import com.smartlaundromat.machine.dto.MachineStatusResponse;
import com.smartlaundromat.machine.dto.MachineSummaryResponse;
import com.smartlaundromat.machine.dto.StartCycleRequest;
import com.smartlaundromat.machine.dto.TelemetryPayload;
import com.smartlaundromat.machine.eqlink.EqLinkProperties;
import com.smartlaundromat.machine.exception.MachineNotAvailableException;
import com.smartlaundromat.machine.exception.MachineNotFoundException;
import com.smartlaundromat.machine.modbus.ModbusProperties;
import com.smartlaundromat.machine.model.Machine;
import com.smartlaundromat.machine.model.MachineCycle;
import com.smartlaundromat.machine.model.MachineEvent;
import com.smartlaundromat.machine.model.enums.*;
import com.smartlaundromat.machine.mqtt.MqttService;
import com.smartlaundromat.machine.repository.MachineCycleRepository;
import com.smartlaundromat.machine.repository.MachineEventRepository;
import com.smartlaundromat.machine.repository.MachineRepository;
import com.smartlaundromat.machine.simulator.MachineCommandDispatcher;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class MachineServiceTest {

    @Mock MachineRepository machineRepository;
    @Mock MachineEventRepository machineEventRepository;
    @Mock MachineCycleRepository machineCycleRepository;
    @Mock MachineConfig machineConfig;
    @Mock MqttService mqttService;
    @Mock EqLinkProperties eqLinkProperties;
    @Mock ModbusProperties modbusProperties;
    @Mock ReservationService reservationService;
    @Mock MachineCommandDispatcher commandDispatcher;
    @Mock MeterRegistry meterRegistry;
    @Mock Counter mockCounter;

    @InjectMocks
    MachineService machineService;

    private Machine idleMachine;

    @BeforeEach
    void setUp() {
        lenient().when(meterRegistry.counter(any(String.class), any(String[].class))).thenReturn(mockCounter);
        idleMachine = Machine.builder()
                .machineId("washer_01")
                .type(MachineType.WASHER)
                .status(MachineStatus.IDLE)
                .isOnline(true)
                .doorLocked(false)
                .commProtocol(CommProtocol.MQTT)
                .position(1)
                .build();
    }

    // ── processTelemetry ───────────────────────────────────────────────────────

    @Nested
    class ProcessTelemetry {

        @Test
        void shouldIgnoreUnknownMachine() {
            // given
            TelemetryPayload payload = new TelemetryPayload();
            payload.setMachineId("unknown_99");
            when(machineRepository.findByMachineId("unknown_99")).thenReturn(Optional.empty());

            // when
            machineService.processTelemetry(payload);

            // then
            verify(machineRepository, never()).save(any());
        }

        @Test
        void shouldUpdateMachineFieldsFromTelemetry() {
            // given
            when(machineRepository.findByMachineId("washer_01")).thenReturn(Optional.of(idleMachine));
            when(machineRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

            TelemetryPayload payload = new TelemetryPayload();
            payload.setMachineId("washer_01");
            payload.setStatus("RUNNING");
            payload.setCycleType("HEAVY");
            payload.setCycleProgress(50);
            payload.setTemperature(60.0);
            payload.setHumidity(80.0);
            payload.setWaterLevel(5.0);
            payload.setSpinSpeed(1200);
            payload.setVibration(0.5);
            payload.setDoorLocked(true);
            payload.setPowerConsumption(500.0);
            payload.setErrorCode("E01");
            payload.setErrorMessage("Test error");
            payload.setTotalCycles(100);

            // when
            machineService.processTelemetry(payload);

            // then
            assertThat(idleMachine.getStatus()).isEqualTo(MachineStatus.RUNNING);
            assertThat(idleMachine.getCurrentCycleType()).isEqualTo(CycleType.HEAVY);
            assertThat(idleMachine.getCycleProgress()).isEqualTo(50);
            assertThat(idleMachine.getTemperature()).isEqualTo(60.0);
            assertThat(idleMachine.getDoorLocked()).isTrue();
            assertThat(idleMachine.getIsOnline()).isTrue();
            assertThat(idleMachine.getLastHeartbeat()).isNotNull();
            verify(machineRepository).save(idleMachine);
            // Status changed from IDLE to RUNNING, so an event should be recorded
            verify(machineEventRepository).save(any(MachineEvent.class));
        }

        @Test
        void shouldNotRecordEventWhenStatusUnchanged() {
            // given
            idleMachine.setStatus(MachineStatus.RUNNING);
            when(machineRepository.findByMachineId("washer_01")).thenReturn(Optional.of(idleMachine));
            when(machineRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

            TelemetryPayload payload = new TelemetryPayload();
            payload.setMachineId("washer_01");
            payload.setStatus("RUNNING");

            // when
            machineService.processTelemetry(payload);

            // then
            verify(machineEventRepository, never()).save(any());
        }

        @Test
        void shouldHandleInvalidStatusGracefully() {
            // given
            when(machineRepository.findByMachineId("washer_01")).thenReturn(Optional.of(idleMachine));
            when(machineRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

            TelemetryPayload payload = new TelemetryPayload();
            payload.setMachineId("washer_01");
            payload.setStatus("INVALID_STATUS");

            // when
            machineService.processTelemetry(payload);

            // then
            assertThat(idleMachine.getStatus()).isEqualTo(MachineStatus.IDLE); // unchanged
            verify(machineRepository).save(idleMachine);
        }

        @Test
        void shouldNotDowngradeRunningMachineFromStaleIdleTelemetry() {
            // given: machine is live-RUNNING (e.g. startCycle() committed after this telemetry
            // snapshot was built by the simulator's batched heartbeat)
            idleMachine.setStatus(MachineStatus.RUNNING);
            idleMachine.setCurrentCycleType(CycleType.HEAVY);
            idleMachine.setCycleProgress(40);
            idleMachine.setDoorLocked(true);
            when(machineRepository.findByMachineId("washer_01")).thenReturn(Optional.of(idleMachine));
            when(machineRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

            TelemetryPayload payload = new TelemetryPayload();
            payload.setMachineId("washer_01");
            payload.setStatus("IDLE");
            payload.setDoorLocked(false);
            payload.setSpinSpeed(0);

            // when
            machineService.processTelemetry(payload);

            // then: RUNNING and its cycle fields are preserved; only heartbeat bookkeeping updates
            assertThat(idleMachine.getStatus()).isEqualTo(MachineStatus.RUNNING);
            assertThat(idleMachine.getCurrentCycleType()).isEqualTo(CycleType.HEAVY);
            assertThat(idleMachine.getCycleProgress()).isEqualTo(40);
            assertThat(idleMachine.getDoorLocked()).isTrue();
            assertThat(idleMachine.getIsOnline()).isTrue();
            assertThat(idleMachine.getLastHeartbeat()).isNotNull();
            verify(machineRepository).save(idleMachine);
            verify(machineEventRepository, never()).save(any());
        }

        @Test
        void shouldApplyRealErrorTransitionWhileRunning() {
            // given: a real hardware fault reported mid-cycle - must NOT be swallowed by the
            // stale-idle-heartbeat guard, which is scoped only to bare IDLE with no error data
            idleMachine.setStatus(MachineStatus.RUNNING);
            when(machineRepository.findByMachineId("washer_01")).thenReturn(Optional.of(idleMachine));
            when(machineRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

            TelemetryPayload payload = new TelemetryPayload();
            payload.setMachineId("washer_01");
            payload.setStatus("ERROR");
            payload.setErrorCode("E99");
            payload.setErrorMessage("Door open mid-cycle");

            // when
            machineService.processTelemetry(payload);

            // then
            assertThat(idleMachine.getStatus()).isEqualTo(MachineStatus.ERROR);
            assertThat(idleMachine.getErrorCode()).isEqualTo("E99");
            assertThat(idleMachine.getErrorMessage()).isEqualTo("Door open mid-cycle");
            verify(machineRepository).save(idleMachine);
            // Status changed from RUNNING to ERROR, so an event should be recorded
            verify(machineEventRepository).save(any(MachineEvent.class));
        }

        @Test
        void shouldHandleNullFieldsInTelemetry() {
            // given
            when(machineRepository.findByMachineId("washer_01")).thenReturn(Optional.of(idleMachine));
            when(machineRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

            TelemetryPayload payload = new TelemetryPayload();
            payload.setMachineId("washer_01");
            // all fields null except machineId

            // when
            machineService.processTelemetry(payload);

            // then
            assertThat(idleMachine.getIsOnline()).isTrue();
            verify(machineRepository).save(idleMachine);
        }
    }

    // ── startCycle ─────────────────────────────────────────────────────────────

    @Nested
    class StartCycle {

        private StartCycleRequest buildRequest() {
            StartCycleRequest request = new StartCycleRequest();
            request.setMachineId("washer_01");
            request.setCycleType("NORMAL");
            request.setDurationMinutes(30);
            request.setPulseCount(2);
            request.setRfidCardUid("RFID-001");
            request.setTransactionReference("TXN-001");
            return request;
        }

        @Test
        void shouldThrowWhenMachineNotFound() {
            // given
            StartCycleRequest request = buildRequest();
            when(machineRepository.findByMachineIdForUpdate("washer_01")).thenReturn(Optional.empty());

            // when / then
            assertThatThrownBy(() -> machineService.startCycle(request))
                    .isInstanceOf(MachineNotFoundException.class);
        }

        @Test
        void shouldThrowWhenMachineNotAvailable() {
            // given
            idleMachine.setStatus(MachineStatus.RUNNING);
            when(machineRepository.findByMachineIdForUpdate("washer_01")).thenReturn(Optional.of(idleMachine));
            StartCycleRequest request = buildRequest();

            // when / then
            assertThatThrownBy(() -> machineService.startCycle(request))
                    .isInstanceOf(MachineNotAvailableException.class)
                    .hasMessageContaining("not available");
        }

        @Test
        void shouldThrowWhenCycleAlreadyInProgress() {
            // given
            when(machineRepository.findByMachineIdForUpdate("washer_01")).thenReturn(Optional.of(idleMachine));
            when(machineCycleRepository.findByMachineIdAndStatus("washer_01", CycleStatus.IN_PROGRESS))
                    .thenReturn(Optional.of(new MachineCycle()));
            StartCycleRequest request = buildRequest();

            // when / then
            assertThatThrownBy(() -> machineService.startCycle(request))
                    .isInstanceOf(MachineNotAvailableException.class)
                    .hasMessageContaining("active cycle");
        }

        @Test
        void shouldStartCycleSuccessfully() {
            // given
            when(machineRepository.findByMachineIdForUpdate("washer_01")).thenReturn(Optional.of(idleMachine));
            when(machineCycleRepository.findByMachineIdAndStatus("washer_01", CycleStatus.IN_PROGRESS))
                    .thenReturn(Optional.empty());
            when(reservationService.activeReservationCovering("washer_01")).thenReturn(Optional.empty());
            when(machineCycleRepository.save(any(MachineCycle.class))).thenAnswer(inv -> inv.getArgument(0));
            when(machineRepository.save(any(Machine.class))).thenAnswer(inv -> inv.getArgument(0));

            StartCycleRequest request = buildRequest();

            // when
            MachineCycle cycle = machineService.startCycle(request);

            // then
            assertThat(cycle).isNotNull();
            assertThat(cycle.getCycleType()).isEqualTo(CycleType.NORMAL);
            assertThat(cycle.getStatus()).isEqualTo(CycleStatus.IN_PROGRESS);
            assertThat(cycle.getDurationMinutes()).isEqualTo(30);
            assertThat(idleMachine.getStatus()).isEqualTo(MachineStatus.RUNNING);
            assertThat(idleMachine.getDoorLocked()).isTrue();
            verify(commandDispatcher).dispatch(eq(idleMachine), eq(request), eq(CycleType.NORMAL));
            verify(machineEventRepository).save(any(MachineEvent.class));
        }

        @Test
        void shouldDefaultToNormalCycleTypeWhenInvalid() {
            // given
            when(machineRepository.findByMachineIdForUpdate("washer_01")).thenReturn(Optional.of(idleMachine));
            when(machineCycleRepository.findByMachineIdAndStatus("washer_01", CycleStatus.IN_PROGRESS))
                    .thenReturn(Optional.empty());
            when(reservationService.activeReservationCovering("washer_01")).thenReturn(Optional.empty());
            when(machineCycleRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
            when(machineRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

            StartCycleRequest request = buildRequest();
            request.setCycleType("INVALID_TYPE");

            // when
            MachineCycle cycle = machineService.startCycle(request);

            // then
            assertThat(cycle.getCycleType()).isEqualTo(CycleType.NORMAL);
        }

        @Test
        void shouldThrowWhenMachineReservedWithoutCode() {
            // given
            when(machineRepository.findByMachineIdForUpdate("washer_01")).thenReturn(Optional.of(idleMachine));
            when(machineCycleRepository.findByMachineIdAndStatus("washer_01", CycleStatus.IN_PROGRESS))
                    .thenReturn(Optional.empty());

            var reservation = com.smartlaundromat.machine.model.Reservation.builder()
                    .reservationCode("RES-ABC")
                    .machineId("washer_01")
                    .status(ReservationStatus.ACTIVE)
                    .feeAmount(1500)
                    .build();
            when(reservationService.activeReservationCovering("washer_01"))
                    .thenReturn(Optional.of(reservation));

            StartCycleRequest request = buildRequest();
            request.setReservationCode(null);

            // when / then
            assertThatThrownBy(() -> machineService.startCycle(request))
                    .isInstanceOf(MachineNotAvailableException.class)
                    .hasMessageContaining("reservation code is required");
        }

        @Test
        void shouldStartCycleWithValidReservationCode() {
            // given
            when(machineRepository.findByMachineIdForUpdate("washer_01")).thenReturn(Optional.of(idleMachine));
            when(machineCycleRepository.findByMachineIdAndStatus("washer_01", CycleStatus.IN_PROGRESS))
                    .thenReturn(Optional.empty());

            var reservation = com.smartlaundromat.machine.model.Reservation.builder()
                    .reservationCode("RES-ABC")
                    .machineId("washer_01")
                    .status(ReservationStatus.ACTIVE)
                    .feeAmount(1500)
                    .build();
            when(reservationService.activeReservationCovering("washer_01"))
                    .thenReturn(Optional.of(reservation));
            when(reservationService.validateAndConsume("RES-ABC", "washer_01")).thenReturn(reservation);
            when(machineCycleRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
            when(machineRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

            StartCycleRequest request = buildRequest();
            request.setReservationCode("RES-ABC");

            // when
            MachineCycle cycle = machineService.startCycle(request);

            // then
            assertThat(cycle).isNotNull();
            verify(reservationService).validateAndConsume("RES-ABC", "washer_01");
        }

        @Test
        void shouldThrowWhenWalkInDurationWouldOverlapUpcomingReservation() {
            // given — nothing covers "now", but the requested duration would run into a
            // reservation starting soon (e.g. a 60-min walk-in wash at 9:55 for a 10:00 reservation)
            when(machineRepository.findByMachineIdForUpdate("washer_01")).thenReturn(Optional.of(idleMachine));
            when(machineCycleRepository.findByMachineIdAndStatus("washer_01", CycleStatus.IN_PROGRESS))
                    .thenReturn(Optional.empty());
            when(reservationService.activeReservationCovering("washer_01")).thenReturn(Optional.empty());

            var upcoming = com.smartlaundromat.machine.model.Reservation.builder()
                    .reservationCode("RES-NEXT")
                    .machineId("washer_01")
                    .status(ReservationStatus.ACTIVE)
                    .slotStart(LocalDateTime.now().plusMinutes(5))
                    .feeAmount(1500)
                    .build();
            when(reservationService.findConflicting(eq("washer_01"), any(), any(), isNull()))
                    .thenReturn(Optional.of(upcoming));

            StartCycleRequest request = buildRequest();
            request.setDurationMinutes(60);

            // when / then
            assertThatThrownBy(() -> machineService.startCycle(request))
                    .isInstanceOf(MachineNotAvailableException.class)
                    .hasMessageContaining("would run into that reservation");
            verify(machineCycleRepository, never()).save(any());
        }

        @Test
        void shouldStartWhenNoConflictInWindow() {
            // given
            when(machineRepository.findByMachineIdForUpdate("washer_01")).thenReturn(Optional.of(idleMachine));
            when(machineCycleRepository.findByMachineIdAndStatus("washer_01", CycleStatus.IN_PROGRESS))
                    .thenReturn(Optional.empty());
            when(reservationService.activeReservationCovering("washer_01")).thenReturn(Optional.empty());
            when(reservationService.findConflicting(eq("washer_01"), any(), any(), isNull()))
                    .thenReturn(Optional.empty());
            when(machineCycleRepository.save(any(MachineCycle.class))).thenAnswer(inv -> inv.getArgument(0));
            when(machineRepository.save(any(Machine.class))).thenAnswer(inv -> inv.getArgument(0));

            StartCycleRequest request = buildRequest();

            // when
            MachineCycle cycle = machineService.startCycle(request);

            // then
            assertThat(cycle).isNotNull();
        }

        @Test
        void shouldRejectWhenOwnRedeemedCycleWouldOverrunIntoNextReservation() {
            // given — customer redeems their own code covering "now", but picks a duration long
            // enough to bleed into a DIFFERENT, later reservation. Their own code must be excluded
            // from the conflict search (it's the reservation just consumed), yet the next
            // reservation must still be caught.
            when(machineRepository.findByMachineIdForUpdate("washer_01")).thenReturn(Optional.of(idleMachine));
            when(machineCycleRepository.findByMachineIdAndStatus("washer_01", CycleStatus.IN_PROGRESS))
                    .thenReturn(Optional.empty());

            var ownReservation = com.smartlaundromat.machine.model.Reservation.builder()
                    .reservationCode("RES-OWN")
                    .machineId("washer_01")
                    .status(ReservationStatus.ACTIVE)
                    .feeAmount(1500)
                    .build();
            when(reservationService.activeReservationCovering("washer_01"))
                    .thenReturn(Optional.of(ownReservation));
            when(reservationService.validateAndConsume("RES-OWN", "washer_01")).thenReturn(ownReservation);

            var nextReservation = com.smartlaundromat.machine.model.Reservation.builder()
                    .reservationCode("RES-NEXT")
                    .machineId("washer_01")
                    .status(ReservationStatus.ACTIVE)
                    .slotStart(LocalDateTime.now().plusMinutes(10))
                    .feeAmount(1500)
                    .build();
            when(reservationService.findConflicting(eq("washer_01"), any(), any(), eq("RES-OWN")))
                    .thenReturn(Optional.of(nextReservation));

            StartCycleRequest request = buildRequest();
            request.setReservationCode("RES-OWN");
            request.setDurationMinutes(60);

            // when / then
            assertThatThrownBy(() -> machineService.startCycle(request))
                    .isInstanceOf(MachineNotAvailableException.class)
                    .hasMessageContaining("would run into that reservation");
            verify(machineCycleRepository, never()).save(any());
        }

        @Test
        void shouldRejectAsNotAvailableWhenCycleSaveRacesConcurrentInsert() {
            // given
            when(machineRepository.findByMachineIdForUpdate("washer_01")).thenReturn(Optional.of(idleMachine));
            when(machineCycleRepository.findByMachineIdAndStatus("washer_01", CycleStatus.IN_PROGRESS))
                    .thenReturn(Optional.empty());
            when(reservationService.activeReservationCovering("washer_01")).thenReturn(Optional.empty());
            when(machineCycleRepository.save(any(MachineCycle.class)))
                    .thenThrow(new org.springframework.dao.DataIntegrityViolationException(
                            "duplicate key value violates unique constraint idx_machine_cycles_machine_in_progress",
                            new RuntimeException("duplicate key value violates unique constraint \"idx_machine_cycles_machine_in_progress\"")));

            StartCycleRequest request = buildRequest();

            // when / then
            assertThatThrownBy(() -> machineService.startCycle(request))
                    .isInstanceOf(MachineNotAvailableException.class)
                    .hasMessageContaining("active cycle");
            verify(commandDispatcher, never()).dispatch(any(), any(), any());
        }

        @Test
        void shouldRethrowUnrelatedDataIntegrityViolations() {
            // given
            when(machineRepository.findByMachineIdForUpdate("washer_01")).thenReturn(Optional.of(idleMachine));
            when(machineCycleRepository.findByMachineIdAndStatus("washer_01", CycleStatus.IN_PROGRESS))
                    .thenReturn(Optional.empty());
            when(reservationService.activeReservationCovering("washer_01")).thenReturn(Optional.empty());
            when(machineCycleRepository.save(any(MachineCycle.class)))
                    .thenThrow(new org.springframework.dao.DataIntegrityViolationException(
                            "value too long",
                            new RuntimeException("value too long")));

            StartCycleRequest request = buildRequest();

            // when / then
            assertThatThrownBy(() -> machineService.startCycle(request))
                    .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class)
                    .isNotInstanceOf(MachineNotAvailableException.class);
        }

        @Test
        void shouldReturnExistingCycleWhenIdempotencyRaceLosesAfterLockAcquired() {
            // given — simulates two genuinely concurrent duplicate deliveries of the same
            // transactionReference (e.g. two OutboxRelayService instances): the pre-lock
            // idempotency check (first stub, empty) already ran and found nothing, but by
            // the time THIS call acquires the machine row lock, the other caller has already
            // committed a cycle for this exact transactionReference. The post-lock re-check
            // must return that cycle instead of falling through to the generic
            // "already has an active cycle" rejection.
            MachineCycle winnerCycle = MachineCycle.builder()
                    .machineId("washer_01")
                    .transactionReference("TXN-001")
                    .status(CycleStatus.IN_PROGRESS)
                    .build();
            when(machineRepository.findByMachineIdForUpdate("washer_01")).thenReturn(Optional.of(idleMachine));
            when(machineCycleRepository.findByTransactionReference("TXN-001"))
                    .thenReturn(Optional.empty())   // pre-lock check: nothing yet
                    .thenReturn(Optional.of(winnerCycle));  // post-lock re-check: other caller won

            StartCycleRequest request = buildRequest();

            // when
            MachineCycle result = machineService.startCycle(request);

            // then
            assertThat(result).isSameAs(winnerCycle);
            verify(machineCycleRepository, never()).save(any());
            verify(commandDispatcher, never()).dispatch(any(), any(), any());
        }

        @Test
        void shouldThrowNotAvailableWhenSaveRacesOnTransactionReferenceConstraint() {
            // given — defense-in-depth backstop for the post-lock re-check above: only
            // reachable when two racing calls for the same transactionReference target
            // DIFFERENT machines, so neither shares the other's row lock, and both still
            // slip past their own pre/post-lock checks. We must NOT try to read back the
            // winning row inside this same transaction: Postgres poisons the whole
            // transaction after a failed statement until it's rolled back, so a
            // same-transaction SELECT here would itself fail rather than return the
            // winner. The correct behavior is to throw and let the caller's own retry
            // (fresh transaction) resolve it via the pre-lock idempotency check.
            when(machineRepository.findByMachineIdForUpdate("washer_01")).thenReturn(Optional.of(idleMachine));
            when(machineCycleRepository.findByMachineIdAndStatus("washer_01", CycleStatus.IN_PROGRESS))
                    .thenReturn(Optional.empty());
            when(reservationService.activeReservationCovering("washer_01")).thenReturn(Optional.empty());
            when(machineCycleRepository.findByTransactionReference("TXN-001"))
                    .thenReturn(Optional.empty());  // pre-lock and post-lock checks: nothing yet
            when(machineCycleRepository.save(any(MachineCycle.class)))
                    .thenThrow(new org.springframework.dao.DataIntegrityViolationException(
                            "duplicate key value violates unique constraint idx_machine_cycles_tx_ref",
                            new RuntimeException("duplicate key value violates unique constraint \"idx_machine_cycles_tx_ref\"")));

            StartCycleRequest request = buildRequest();

            // when / then
            assertThatThrownBy(() -> machineService.startCycle(request))
                    .isInstanceOf(MachineNotAvailableException.class)
                    .hasMessageContaining("Duplicate start request");
            verify(commandDispatcher, never()).dispatch(any(), any(), any());
        }
    }

    // ── getMachineStatus ───────────────────────────────────────────────────────

    @Test
    void shouldReturnMachineStatus() {
        // given
        when(machineRepository.findByMachineId("washer_01")).thenReturn(Optional.of(idleMachine));

        // when
        MachineStatusResponse response = machineService.getMachineStatus("washer_01");

        // then
        assertThat(response.getMachineId()).isEqualTo("washer_01");
        assertThat(response.getStatus()).isEqualTo(MachineStatus.IDLE);
        assertThat(response.isAvailable()).isTrue();
    }

    @Test
    void shouldThrowWhenMachineNotFoundForStatus() {
        // given
        when(machineRepository.findByMachineId("washer_99")).thenReturn(Optional.empty());

        // when / then
        assertThatThrownBy(() -> machineService.getMachineStatus("washer_99"))
                .isInstanceOf(MachineNotFoundException.class);
    }

    @Test
    void shouldCalculateRemainingMinutesForRunningMachine() {
        // given
        idleMachine.setStatus(MachineStatus.RUNNING);
        idleMachine.setCycleEndsAt(LocalDateTime.now().plusMinutes(20));
        when(machineRepository.findByMachineId("washer_01")).thenReturn(Optional.of(idleMachine));

        // when
        MachineStatusResponse response = machineService.getMachineStatus("washer_01");

        // then
        assertThat(response.getRemainingMinutes()).isNotNull();
        assertThat(response.getRemainingMinutes()).isGreaterThanOrEqualTo(19);
    }

    // ── getAllMachines ──────────────────────────────────────────────────────────

    @Test
    void shouldReturnAllMachinesSummary() {
        // given
        Machine running = Machine.builder()
                .machineId("washer_02")
                .type(MachineType.WASHER)
                .status(MachineStatus.RUNNING)
                .isOnline(true)
                .doorLocked(false)
                .position(2)
                .build();
        Machine offline = Machine.builder()
                .machineId("dryer_01")
                .type(MachineType.DRYER)
                .status(MachineStatus.IDLE)
                .isOnline(false)
                .doorLocked(false)
                .position(1)
                .build();
        when(machineRepository.findAll()).thenReturn(List.of(idleMachine, running, offline));

        // when
        MachineSummaryResponse summary = machineService.getAllMachines();

        // then
        assertThat(summary.getTotal()).isEqualTo(3);
        assertThat(summary.getAvailable()).isEqualTo(1); // only idleMachine
        assertThat(summary.getInUse()).isEqualTo(1);
        assertThat(summary.getOffline()).isEqualTo(1);
    }

    // ── getMachineEvents / getMachineCycles ─────────────────────────────────────

    @Test
    void shouldReturnMachineEvents() {
        // given
        when(machineEventRepository.findTop50ByMachineIdOrderByCreatedAtDesc("washer_01"))
                .thenReturn(List.of(new MachineEvent()));

        // when
        List<MachineEvent> events = machineService.getMachineEvents("washer_01");

        // then
        assertThat(events).hasSize(1);
    }

    @Test
    void shouldReturnMachineCycles() {
        // given
        when(machineCycleRepository.findByMachineIdOrderByCreatedAtDesc("washer_01"))
                .thenReturn(List.of(new MachineCycle()));

        // when
        List<MachineCycle> cycles = machineService.getMachineCycles("washer_01");

        // then
        assertThat(cycles).hasSize(1);
    }

    // ── sendCommand ────────────────────────────────────────────────────────────

    @Test
    void shouldSendCommandViaMqtt() {
        // given
        when(machineRepository.findByMachineId("washer_01")).thenReturn(Optional.of(idleMachine));

        // when
        machineService.sendCommand("washer_01", "stop");

        // then
        verify(mqttService).sendCommand("washer_01", "stop", null);
        verify(machineEventRepository).save(any(MachineEvent.class));
    }

    @Test
    void shouldThrowWhenSendingCommandToUnknownMachine() {
        // given
        when(machineRepository.findByMachineId("unknown")).thenReturn(Optional.empty());

        // when / then
        assertThatThrownBy(() -> machineService.sendCommand("unknown", "stop"))
                .isInstanceOf(MachineNotFoundException.class);
    }

    // ── Modbus program mapping ─────────────────────────────────────────────────

    @ParameterizedTest
    @CsvSource({
            "QUICK,     NORMAL, 30, 2",
            "HEAVY,     NORMAL, 30, 2",
            "NORMAL,    NORMAL, 30, 2",
    })
    void shouldStartCycleWithVariousCycleTypes(String cycleType, String expectedDefault,
                                                int duration, int pulseCount) {
        // given
        when(machineRepository.findByMachineIdForUpdate("washer_01")).thenReturn(Optional.of(idleMachine));
        when(machineCycleRepository.findByMachineIdAndStatus("washer_01", CycleStatus.IN_PROGRESS))
                .thenReturn(Optional.empty());
        when(reservationService.activeReservationCovering("washer_01")).thenReturn(Optional.empty());
        when(machineCycleRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        when(machineRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        StartCycleRequest request = new StartCycleRequest();
        request.setMachineId("washer_01");
        request.setCycleType(cycleType);
        request.setDurationMinutes(duration);
        request.setPulseCount(pulseCount);

        // when
        MachineCycle cycle = machineService.startCycle(request);

        // then
        assertThat(cycle).isNotNull();
        assertThat(cycle.getStatus()).isEqualTo(CycleStatus.IN_PROGRESS);
    }
}
