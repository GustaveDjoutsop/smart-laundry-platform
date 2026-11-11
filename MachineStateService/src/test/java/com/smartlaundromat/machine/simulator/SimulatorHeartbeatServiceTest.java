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
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.eq;
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
        void shouldApplyHeartbeatAsBulkUpdatesWhenTicking() {
            // when
            service.sendHeartbeats();

            // then: two set-based statements, no per-machine read or entity save
            verify(machineRepository).markSimulatedMachinesIdle(
                    eq(List.of("washer_01", "dryer_01")), eq(MachineStatus.IDLE),
                    anyCollection(), any(LocalDateTime.class));
            verify(machineRepository).markHeartbeatOnly(
                    eq(List.of("washer_01", "dryer_01")), anyCollection(), any(LocalDateTime.class));
            verifyNoInteractions(machineService);
            verify(machineRepository, never()).save(any());
        }

        @Test
        void shouldNotOverwriteLiveOrFaultedStatusesWhenMarkingIdle() {
            // when
            service.sendHeartbeats();

            // then: the idle UPDATE excludes all four, so a machine that turns RUNNING mid-tick is
            // skipped by the database, and a real ERROR or MAINTENANCE is never cleared
            ArgumentCaptor<Collection<MachineStatus>> captor = ArgumentCaptor.captor();
            verify(machineRepository).markSimulatedMachinesIdle(
                    any(), eq(MachineStatus.IDLE), captor.capture(), any(LocalDateTime.class));
            assertThat(captor.getValue()).containsExactlyInAnyOrder(
                    MachineStatus.RUNNING, MachineStatus.FINISHED,
                    MachineStatus.ERROR, MachineStatus.MAINTENANCE);
        }

        @Test
        void shouldStillHeartbeatPreservedStatusesExceptRunning() {
            // when
            service.sendHeartbeats();

            // then: a FINISHED, ERROR or MAINTENANCE machine keeps its status but must not be
            // swept OFFLINE by CycleMonitorService for want of a heartbeat
            ArgumentCaptor<Collection<MachineStatus>> captor = ArgumentCaptor.captor();
            verify(machineRepository).markHeartbeatOnly(
                    any(), captor.capture(), any(LocalDateTime.class));
            assertThat(captor.getValue()).containsExactlyInAnyOrder(
                    MachineStatus.FINISHED, MachineStatus.ERROR, MachineStatus.MAINTENANCE);
        }

        @Test
        void shouldStampBothUpdatesWithTheSameHeartbeatInstant() {
            // when
            service.sendHeartbeats();

            // then
            ArgumentCaptor<LocalDateTime> idleAt = ArgumentCaptor.forClass(LocalDateTime.class);
            ArgumentCaptor<LocalDateTime> finishedAt = ArgumentCaptor.forClass(LocalDateTime.class);
            verify(machineRepository).markSimulatedMachinesIdle(
                    any(), any(), anyCollection(), idleAt.capture());
            verify(machineRepository).markHeartbeatOnly(any(), anyCollection(), finishedAt.capture());
            assertThat(idleAt.getValue()).isEqualTo(finishedAt.getValue());
        }
    }

    // ── rejectNonLocalDatabase ─────────────────────────────────────────────────

    @Nested
    class RejectNonLocalDatabase {

        @Test
        void shouldStartWhenDatabaseIsLocal() {
            // given
            ReflectionTestUtils.setField(service, "datasourceUrl",
                    "jdbc:postgresql://localhost:5435/machinedb");

            // when
            Throwable thrown = catchThrowable(() -> service.rejectNonLocalDatabase());

            // then
            assertThat(thrown).isNull();
        }

        @Test
        void shouldFailFastWhenDatabaseIsRemote() {
            // given
            ReflectionTestUtils.setField(service, "datasourceUrl",
                    "jdbc:postgresql://aws-0-eu-central-1.pooler.supabase.com:6543/postgres");

            // when
            Throwable thrown = catchThrowable(() -> service.rejectNonLocalDatabase());

            // then
            assertThat(thrown)
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("SIMULATOR_ENABLED=false");
        }

        @Test
        void shouldFailFastWhenDatasourceUrlIsMissing() {
            // given
            ReflectionTestUtils.setField(service, "datasourceUrl", "");

            // when
            Throwable thrown = catchThrowable(() -> service.rejectNonLocalDatabase());

            // then
            assertThat(thrown).isInstanceOf(IllegalStateException.class);
        }

        @Test
        void shouldStartAgainstRemoteDatabaseWhenExplicitlyAllowed() {
            // given
            ReflectionTestUtils.setField(service, "datasourceUrl",
                    "jdbc:postgresql://aws-0-eu-central-1.pooler.supabase.com:6543/postgres");
            ReflectionTestUtils.setField(service, "allowNonLocalDatabase", true);

            // when
            Throwable thrown = catchThrowable(() -> service.rejectNonLocalDatabase());

            // then
            assertThat(thrown).isNull();
        }

        @ParameterizedTest
        @ValueSource(strings = {
                "jdbc:postgresql://localhost:5435/machinedb",
                "jdbc:postgresql://localhost/machinedb",
                "jdbc:postgresql://127.0.0.1:5435/machinedb",
                "jdbc:postgresql://[::1]:5435/machinedb",
                "jdbc:postgresql://host.docker.internal:5435/machinedb",
                "jdbc:postgresql://machine_user:pass@localhost:5435/machinedb",
                "jdbc:postgresql://localhost:5435/machinedb?sslmode=disable",
                "JDBC:POSTGRESQL://LOCALHOST:5435/machinedb"
        })
        void shouldRecogniseLocalDatabaseWhenHostIsLoopback(String url) {
            // when
            boolean local = SimulatorHeartbeatService.isLocalDatabase(url);

            // then
            assertThat(local).isTrue();
        }

        @ParameterizedTest
        @ValueSource(strings = {
                "jdbc:postgresql://aws-0-eu-central-1.pooler.supabase.com:6543/postgres",
                "jdbc:postgresql://db.example.supabase.co:5432/postgres",
                "jdbc:postgresql://machinedb.internal:5432/machinedb",
                // the substring traps: a remote host that merely contains a loopback token,
                // and a loopback token appearing only in the database name or query string
                "jdbc:postgresql://localhost.evil.example.com:5432/machinedb",
                "jdbc:postgresql://db.example.com:5432/localhost",
                "jdbc:postgresql://db.example.com:5432/machinedb?options=-csearch_path=localhost"
        })
        void shouldRejectDatabaseWhenHostIsRemote(String url) {
            // when
            boolean local = SimulatorHeartbeatService.isLocalDatabase(url);

            // then
            assertThat(local).isFalse();
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
            when(machineRepository.findByMachineIdInAndStatus(List.of("washer_01", "dryer_01"), MachineStatus.RUNNING))
                    .thenReturn(List.of(washer));

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
            when(machineRepository.findByMachineIdInAndStatus(List.of("washer_01", "dryer_01"), MachineStatus.RUNNING))
                    .thenReturn(List.of());

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
