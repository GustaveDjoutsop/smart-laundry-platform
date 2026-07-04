package com.smartlaundromat.machine.simulator;

import com.smartlaundromat.machine.config.MachineConfig;
import com.smartlaundromat.machine.dto.TelemetryPayload;
import com.smartlaundromat.machine.model.Machine;
import com.smartlaundromat.machine.model.enums.MachineStatus;
import com.smartlaundromat.machine.model.enums.MachineType;
import com.smartlaundromat.machine.repository.MachineRepository;
import com.smartlaundromat.machine.service.MachineService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class SimulatorHeartbeatServiceTest {

    @Mock MachineService machineService;
    @Mock MachineRepository machineRepository;
    @Mock MachineConfig machineConfig;

    @InjectMocks SimulatorHeartbeatService service;

    private Machine washer;
    private Machine dryer;

    @BeforeEach
    void setUp() {
        washer = Machine.builder()
                .machineId("washer_01")
                .type(MachineType.WASHER)
                .status(MachineStatus.IDLE)
                .isOnline(false)
                .build();
        dryer = Machine.builder()
                .machineId("dryer_01")
                .type(MachineType.DRYER)
                .status(MachineStatus.IDLE)
                .isOnline(false)
                .build();
        lenient().when(machineConfig.getAvailableIds()).thenReturn(List.of("washer_01", "dryer_01"));
    }

    // ── sendHeartbeats ─────────────────────────────────────────────────────────

    @Nested
    class SendHeartbeats {

        @Test
        void shouldSendIdleTelemetryForOfflineMachines() {
            when(machineRepository.findByMachineId("washer_01")).thenReturn(Optional.of(washer));
            when(machineRepository.findByMachineId("dryer_01")).thenReturn(Optional.of(dryer));

            service.sendHeartbeats();

            verify(machineService, times(2)).processTelemetry(any(TelemetryPayload.class));
        }

        @Test
        void shouldSendIdleStatusInPayload() {
            when(machineRepository.findByMachineId("washer_01")).thenReturn(Optional.of(washer));
            when(machineRepository.findByMachineId("dryer_01")).thenReturn(Optional.of(dryer));

            service.sendHeartbeats();

            ArgumentCaptor<TelemetryPayload> captor = ArgumentCaptor.forClass(TelemetryPayload.class);
            verify(machineService, times(2)).processTelemetry(captor.capture());
            captor.getAllValues().forEach(t -> assertThat(t.getStatus()).isEqualTo("IDLE"));
        }

        @Test
        void shouldSkipRunningMachines() {
            washer.setStatus(MachineStatus.RUNNING);
            when(machineRepository.findByMachineId("washer_01")).thenReturn(Optional.of(washer));
            when(machineRepository.findByMachineId("dryer_01")).thenReturn(Optional.of(dryer));

            service.sendHeartbeats();

            // only dryer gets the heartbeat; washer is RUNNING
            verify(machineService, times(1)).processTelemetry(any(TelemetryPayload.class));
        }

        @Test
        void shouldPreserveFinishedStatusInPayload() {
            washer.setStatus(MachineStatus.FINISHED);
            when(machineRepository.findByMachineId("washer_01")).thenReturn(Optional.of(washer));
            when(machineRepository.findByMachineId("dryer_01")).thenReturn(Optional.of(dryer));

            service.sendHeartbeats();

            ArgumentCaptor<TelemetryPayload> captor = ArgumentCaptor.forClass(TelemetryPayload.class);
            verify(machineService, times(2)).processTelemetry(captor.capture());
            List<String> statuses = captor.getAllValues().stream().map(TelemetryPayload::getStatus).toList();
            assertThat(statuses).contains("FINISHED", "IDLE");
        }
    }

    // ── updateRunningMachines ──────────────────────────────────────────────────

    @Nested
    class UpdateRunningMachines {

        @Test
        void shouldSendRunningTelemetryForRunningMachines() {
            washer.setStatus(MachineStatus.RUNNING);
            washer.setCycleStartedAt(LocalDateTime.now().minusMinutes(15));
            washer.setCycleEndsAt(LocalDateTime.now().plusMinutes(15));
            when(machineRepository.findByStatus(MachineStatus.RUNNING)).thenReturn(List.of(washer));

            service.updateRunningMachines();

            ArgumentCaptor<TelemetryPayload> captor = ArgumentCaptor.forClass(TelemetryPayload.class);
            verify(machineService).processTelemetry(captor.capture());
            TelemetryPayload t = captor.getValue();
            assertThat(t.getMachineId()).isEqualTo("washer_01");
            assertThat(t.getStatus()).isEqualTo("RUNNING");
            assertThat(t.getDoorLocked()).isTrue();
            assertThat(t.getCycleProgress()).isGreaterThan(0).isLessThan(100);
        }

        @Test
        void shouldSkipWhenNoRunningMachines() {
            when(machineRepository.findByStatus(MachineStatus.RUNNING)).thenReturn(List.of());

            service.updateRunningMachines();

            verifyNoInteractions(machineService);
        }
    }

    // ── computeProgress ────────────────────────────────────────────────────────

    @Nested
    class ComputeProgress {

        @Test
        void shouldReturnZeroWhenNoCycleTimestamps() {
            washer.setCycleStartedAt(null);
            washer.setCycleEndsAt(null);
            assertThat(service.computeProgress(washer)).isEqualTo(0);
        }

        @Test
        void shouldReturnApproximatelyFiftyAtMidpoint() {
            washer.setCycleStartedAt(LocalDateTime.now().minusMinutes(15));
            washer.setCycleEndsAt(LocalDateTime.now().plusMinutes(15));
            int progress = service.computeProgress(washer);
            assertThat(progress).isBetween(48, 52);
        }

        @Test
        void shouldCapAtNinetyNineBeforeCompletion() {
            // started 59 min into a 60-min cycle
            washer.setCycleStartedAt(LocalDateTime.now().minusMinutes(59));
            washer.setCycleEndsAt(LocalDateTime.now().plusMinutes(1));
            assertThat(service.computeProgress(washer)).isLessThanOrEqualTo(99);
        }
    }

    // ── buildIdleTelemetry ─────────────────────────────────────────────────────

    @Test
    void shouldBuildIdleTelemetryWithCorrectFields() {
        TelemetryPayload t = service.buildIdleTelemetry(washer);
        assertThat(t.getMachineId()).isEqualTo("washer_01");
        assertThat(t.getStatus()).isEqualTo("IDLE");
        assertThat(t.getDoorLocked()).isFalse();
        assertThat(t.getSpinSpeed()).isEqualTo(0);
        assertThat(t.getTemperature()).isNotNull();
    }

    @Test
    void shouldBuildRunningTelemetryWithCorrectFields() {
        washer.setCycleStartedAt(LocalDateTime.now().minusMinutes(10));
        washer.setCycleEndsAt(LocalDateTime.now().plusMinutes(20));
        TelemetryPayload t = service.buildRunningTelemetry(washer);
        assertThat(t.getMachineId()).isEqualTo("washer_01");
        assertThat(t.getStatus()).isEqualTo("RUNNING");
        assertThat(t.getDoorLocked()).isTrue();
        assertThat(t.getTemperature()).isGreaterThan(22.0);
    }
}
