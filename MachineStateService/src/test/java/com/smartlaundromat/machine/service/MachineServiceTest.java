package com.smartlaundromat.machine.service;

import com.smartlaundromat.machine.config.MachineConfig;
import com.smartlaundromat.machine.dto.MachineStatusResponse;
import com.smartlaundromat.machine.dto.MachineSummaryResponse;
import com.smartlaundromat.machine.dto.StartCycleRequest;
import com.smartlaundromat.machine.dto.TelemetryPayload;
import com.smartlaundromat.machine.eqlink.EqLinkClient;
import com.smartlaundromat.machine.eqlink.EqLinkProperties;
import com.smartlaundromat.machine.exception.MachineNotAvailableException;
import com.smartlaundromat.machine.exception.MachineNotFoundException;
import com.smartlaundromat.machine.modbus.ModbusClient;
import com.smartlaundromat.machine.modbus.ModbusProperties;
import com.smartlaundromat.machine.model.Machine;
import com.smartlaundromat.machine.model.MachineCycle;
import com.smartlaundromat.machine.model.MachineEvent;
import com.smartlaundromat.machine.model.enums.*;
import com.smartlaundromat.machine.mqtt.MqttService;
import com.smartlaundromat.machine.repository.MachineCycleRepository;
import com.smartlaundromat.machine.repository.MachineEventRepository;
import com.smartlaundromat.machine.repository.MachineRepository;
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
    @Mock EqLinkClient eqLinkClient;
    @Mock EqLinkProperties eqLinkProperties;
    @Mock ModbusClient modbusClient;
    @Mock ModbusProperties modbusProperties;
    @Mock ReservationService reservationService;

    @InjectMocks
    MachineService machineService;

    private Machine idleMachine;

    @BeforeEach
    void setUp() {
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
            when(machineRepository.findByMachineId("washer_01")).thenReturn(Optional.empty());

            // when / then
            assertThatThrownBy(() -> machineService.startCycle(request))
                    .isInstanceOf(MachineNotFoundException.class);
        }

        @Test
        void shouldThrowWhenMachineNotAvailable() {
            // given
            idleMachine.setStatus(MachineStatus.RUNNING);
            when(machineRepository.findByMachineId("washer_01")).thenReturn(Optional.of(idleMachine));
            StartCycleRequest request = buildRequest();

            // when / then
            assertThatThrownBy(() -> machineService.startCycle(request))
                    .isInstanceOf(MachineNotAvailableException.class)
                    .hasMessageContaining("not available");
        }

        @Test
        void shouldThrowWhenCycleAlreadyInProgress() {
            // given
            when(machineRepository.findByMachineId("washer_01")).thenReturn(Optional.of(idleMachine));
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
            when(machineRepository.findByMachineId("washer_01")).thenReturn(Optional.of(idleMachine));
            when(machineCycleRepository.findByMachineIdAndStatus("washer_01", CycleStatus.IN_PROGRESS))
                    .thenReturn(Optional.empty());
            when(reservationService.activeReservationCovering("washer_01")).thenReturn(Optional.empty());
            when(machineCycleRepository.save(any(MachineCycle.class))).thenAnswer(inv -> inv.getArgument(0));
            when(machineRepository.save(any(Machine.class))).thenAnswer(inv -> inv.getArgument(0));
            when(eqLinkProperties.isEnabled()).thenReturn(false);

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
            verify(mqttService).sendCommand(eq("washer_01"), eq("pulse"), eq(2));
            verify(machineEventRepository).save(any(MachineEvent.class));
        }

        @Test
        void shouldDefaultToNormalCycleTypeWhenInvalid() {
            // given
            when(machineRepository.findByMachineId("washer_01")).thenReturn(Optional.of(idleMachine));
            when(machineCycleRepository.findByMachineIdAndStatus("washer_01", CycleStatus.IN_PROGRESS))
                    .thenReturn(Optional.empty());
            when(reservationService.activeReservationCovering("washer_01")).thenReturn(Optional.empty());
            when(machineCycleRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
            when(machineRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
            when(eqLinkProperties.isEnabled()).thenReturn(false);

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
            when(machineRepository.findByMachineId("washer_01")).thenReturn(Optional.of(idleMachine));
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
            when(machineRepository.findByMachineId("washer_01")).thenReturn(Optional.of(idleMachine));
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
            when(eqLinkProperties.isEnabled()).thenReturn(false);

            StartCycleRequest request = buildRequest();
            request.setReservationCode("RES-ABC");

            // when
            MachineCycle cycle = machineService.startCycle(request);

            // then
            assertThat(cycle).isNotNull();
            verify(reservationService).validateAndConsume("RES-ABC", "washer_01");
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
        when(machineRepository.findByMachineId("washer_01")).thenReturn(Optional.of(idleMachine));
        when(machineCycleRepository.findByMachineIdAndStatus("washer_01", CycleStatus.IN_PROGRESS))
                .thenReturn(Optional.empty());
        when(reservationService.activeReservationCovering("washer_01")).thenReturn(Optional.empty());
        when(machineCycleRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        when(machineRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        when(eqLinkProperties.isEnabled()).thenReturn(false);

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
