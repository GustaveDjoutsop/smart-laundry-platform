package com.smartlaundromat.machine.repository;

import com.smartlaundromat.machine.model.Machine;
import com.smartlaundromat.machine.model.enums.MachineStatus;
import com.smartlaundromat.machine.model.enums.MachineType;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.TestPropertySource;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Behavioural cover for the two set-based heartbeat statements that replaced the simulator's
 * per-machine read-then-write loop. These run as real SQL rather than through a mock, because what
 * matters is which rows the {@code WHERE} clauses actually match — the whole point of the change is
 * that the database, not application code, decides which machines a heartbeat may touch.
 */
@DataJpaTest
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:heartbeatdb;DB_CLOSE_DELAY=-1;INIT=CREATE SCHEMA IF NOT EXISTS machine"
})
class MachineRepositoryHeartbeatTest {

    private static final List<String> SIMULATED_IDS = List.of("washer_01", "dryer_01");
    private static final List<MachineStatus> HEARTBEAT_ONLY_STATUSES =
            List.of(MachineStatus.FINISHED, MachineStatus.ERROR, MachineStatus.MAINTENANCE);
    private static final List<MachineStatus> PRESERVED_STATUSES =
            List.of(MachineStatus.RUNNING, MachineStatus.FINISHED,
                    MachineStatus.ERROR, MachineStatus.MAINTENANCE);

    @Autowired
    private MachineRepository machineRepository;

    @Autowired
    private EntityManager entityManager;

    private LocalDateTime heartbeatAt;
    private LocalDateTime staleHeartbeat;

    @BeforeEach
    void setUp() {
        heartbeatAt = LocalDateTime.now().withNano(0);
        staleHeartbeat = heartbeatAt.minusHours(1);
    }

    @Test
    void shouldBringMachineOnlineWhenItWasOffline() {
        // given
        persist("washer_01", MachineType.WASHER, MachineStatus.OFFLINE, false, true, 900);

        // when
        int updated = markIdle();

        // then
        assertThat(updated).isEqualTo(1);
        Machine washer = reload("washer_01");
        assertThat(washer.getStatus()).isEqualTo(MachineStatus.IDLE);
        assertThat(washer.getIsOnline()).isTrue();
        assertThat(washer.getDoorLocked()).isFalse();
        assertThat(washer.getSpinSpeed()).isZero();
        assertThat(washer.getLastHeartbeat()).isEqualTo(heartbeatAt);
        assertThat(washer.getUpdatedAt()).isEqualTo(heartbeatAt);
    }

    @ParameterizedTest
    @EnumSource(value = MachineStatus.class,
            names = {"RUNNING", "FINISHED", "ERROR", "MAINTENANCE"})
    void shouldLeaveStatusAloneWhenItIsPreserved(MachineStatus preserved) {
        // given: a live cycle, a finished cycle awaiting reset, or a machine a human flagged
        persist("washer_01", MachineType.WASHER, preserved, true, true, 1200);

        // when
        int updated = markIdle();

        // then: the idle statement must not match it at all
        assertThat(updated).isZero();
        Machine washer = reload("washer_01");
        assertThat(washer.getStatus()).isEqualTo(preserved);
        assertThat(washer.getDoorLocked()).isTrue();
        assertThat(washer.getSpinSpeed()).isEqualTo(1200);
        assertThat(washer.getLastHeartbeat()).isEqualTo(staleHeartbeat);
    }

    @ParameterizedTest
    @EnumSource(value = MachineStatus.class, names = {"FINISHED", "ERROR", "MAINTENANCE"})
    void shouldRefreshHeartbeatWithoutTouchingStatusWhenMachineIsPreserved(MachineStatus preserved) {
        // given
        persist("washer_01", MachineType.WASHER, preserved, false, true, 1200);

        // when
        int updated = markHeartbeatOnly();

        // then: still that status, but recent enough that the offline sweep leaves it alone
        assertThat(updated).isEqualTo(1);
        Machine washer = reload("washer_01");
        assertThat(washer.getStatus()).isEqualTo(preserved);
        assertThat(washer.getIsOnline()).isTrue();
        assertThat(washer.getLastHeartbeat()).isEqualTo(heartbeatAt);
        assertThat(washer.getDoorLocked()).isTrue();
        assertThat(washer.getSpinSpeed()).isEqualTo(1200);
    }

    @Test
    void shouldNotRefreshHeartbeatWhenMachineIsRunning() {
        // given: RUNNING machines report through real telemetry, not the heartbeat sweep
        persist("washer_01", MachineType.WASHER, MachineStatus.RUNNING, true, true, 1200);

        // when
        int updated = markHeartbeatOnly();

        // then
        assertThat(updated).isZero();
        assertThat(reload("washer_01").getLastHeartbeat()).isEqualTo(staleHeartbeat);
    }

    @Test
    void shouldIgnoreMachinesOutsideTheConfiguredSetWhenHeartbeating() {
        // given
        persist("washer_01", MachineType.WASHER, MachineStatus.OFFLINE, false, true, 900);
        persist("washer_99", MachineType.WASHER, MachineStatus.OFFLINE, false, true, 900);

        // when
        int updated = markIdle();

        // then
        assertThat(updated).isEqualTo(1);
        Machine unconfigured = reload("washer_99");
        assertThat(unconfigured.getStatus()).isEqualTo(MachineStatus.OFFLINE);
        assertThat(unconfigured.getIsOnline()).isFalse();
        assertThat(unconfigured.getLastHeartbeat()).isEqualTo(staleHeartbeat);
    }

    @Test
    void shouldCoverEveryStatusExactlyOnceAcrossBothStatements() {
        // given: every machine gets exactly one of the two statements per tick, so none is left
        // without a heartbeat and silently swept OFFLINE
        for (MachineStatus status : MachineStatus.values()) {
            boolean preserved = PRESERVED_STATUSES.contains(status);
            boolean heartbeatOnly = HEARTBEAT_ONLY_STATUSES.contains(status);

            // then: RUNNING is the sole deliberate exception — a live cycle reports for itself
            assertThat(preserved && !heartbeatOnly)
                    .as("status %s must be matched by exactly one heartbeat statement", status)
                    .isEqualTo(status == MachineStatus.RUNNING);
        }
    }

    private int markIdle() {
        int updated = machineRepository.markSimulatedMachinesIdle(
                SIMULATED_IDS, MachineStatus.IDLE, PRESERVED_STATUSES, heartbeatAt);
        entityManager.clear();

        return updated;
    }

    private int markHeartbeatOnly() {
        int updated = machineRepository.markHeartbeatOnly(
                SIMULATED_IDS, HEARTBEAT_ONLY_STATUSES, heartbeatAt);
        entityManager.clear();

        return updated;
    }

    private void persist(String machineId, MachineType type, MachineStatus status,
                         boolean online, boolean doorLocked, int spinSpeed) {
        Machine machine = Machine.builder()
                .machineId(machineId)
                .type(type)
                .status(status)
                .isOnline(online)
                .doorLocked(doorLocked)
                .spinSpeed(spinSpeed)
                .lastHeartbeat(staleHeartbeat)
                .updatedAt(staleHeartbeat)
                .build();
        entityManager.persist(machine);
        entityManager.flush();
    }

    private Machine reload(String machineId) {
        return machineRepository.findByMachineId(machineId).orElseThrow();
    }
}
