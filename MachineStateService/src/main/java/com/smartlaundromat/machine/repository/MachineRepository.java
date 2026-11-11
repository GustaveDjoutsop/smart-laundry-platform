package com.smartlaundromat.machine.repository;

import com.smartlaundromat.machine.model.Machine;
import com.smartlaundromat.machine.model.enums.MachineStatus;
import com.smartlaundromat.machine.model.enums.MachineType;
import com.smartlaundromat.machine.repository.projection.MachineStatusRow;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

@Repository
public interface MachineRepository extends JpaRepository<Machine, Long> {

    Optional<Machine> findByMachineId(String machineId);

    /**
     * Locks the machine row for the duration of the caller's transaction, so the
     * active-cycle/reservation check that follows and the subsequent save happen
     * atomically. Without this, two concurrent requests for the same machine can
     * both pass the check before either commits (the double-booking race).
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT m FROM Machine m WHERE m.machineId = :machineId")
    Optional<Machine> findByMachineIdForUpdate(@Param("machineId") String machineId);

    List<Machine> findByType(MachineType type);

    List<Machine> findByStatus(MachineStatus status);

    List<Machine> findByMachineIdInAndStatus(List<String> machineIds, MachineStatus status);

    List<Machine> findByIsOnline(boolean isOnline);

    List<Machine> findByLastHeartbeatBefore(LocalDateTime before);

    boolean existsByMachineId(String machineId);

    /**
     * Every machine as the narrow {@link MachineStatusRow} the status endpoints render, rather
     * than the full entity. Callers that only display status must use this; {@code findAll()}
     * ships 30 columns per row on a query that runs on every dashboard and bot poll.
     */
    @Query("SELECT new com.smartlaundromat.machine.repository.projection.MachineStatusRow("
            + "m.machineId, m.type, m.status, m.isOnline, m.doorLocked, m.currentCycleType, "
            + "m.cycleStartedAt, m.cycleEndsAt, m.cycleProgress, m.temperature, "
            + "m.errorCode, m.errorMessage, m.lastHeartbeat) "
            + "FROM Machine m ORDER BY m.type, m.position")
    List<MachineStatusRow> findAllStatusRows();

    /**
     * Simulator heartbeat for machines that are not mid-cycle: one set-based UPDATE in place of a
     * full-row SELECT plus a whole-entity save per machine per tick. The {@code status NOT IN}
     * filter is evaluated by the database inside the statement itself, so a machine that turns
     * RUNNING concurrently is skipped rather than stomped — the race the read-then-write loop
     * had to guard against in application code.
     * <p>
     * {@code updatedAt} is set explicitly because {@code @PreUpdate} does not fire for bulk JPQL
     * updates.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE Machine m SET m.isOnline = true, m.lastHeartbeat = :heartbeatAt, "
            + "m.updatedAt = :heartbeatAt, m.doorLocked = false, m.spinSpeed = 0, "
            + "m.status = :idleStatus "
            + "WHERE m.machineId IN :machineIds AND m.status NOT IN :preservedStatuses")
    int markSimulatedMachinesIdle(@Param("machineIds") Collection<String> machineIds,
                                  @Param("idleStatus") MachineStatus idleStatus,
                                  @Param("preservedStatuses") Collection<MachineStatus> preservedStatuses,
                                  @Param("heartbeatAt") LocalDateTime heartbeatAt);

    /**
     * Heartbeat bookkeeping only, for machines whose status must survive the tick untouched:
     * FINISHED (cleared by {@code CycleMonitorService} on its own schedule) and the two states
     * that mean a human or a device has something to say about this machine — ERROR and
     * MAINTENANCE. The previous per-machine path reset those to IDLE every tick, which is
     * tolerable when the simulator can only reach a throwaway database and is not once
     * {@code simulator.allow-non-local-database} lets it reach a shared one: clearing a real
     * ERROR every 30 seconds would silently put a faulted machine back on sale.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE Machine m SET m.isOnline = true, m.lastHeartbeat = :heartbeatAt, "
            + "m.updatedAt = :heartbeatAt "
            + "WHERE m.machineId IN :machineIds AND m.status IN :statuses")
    int markHeartbeatOnly(@Param("machineIds") Collection<String> machineIds,
                          @Param("statuses") Collection<MachineStatus> statuses,
                          @Param("heartbeatAt") LocalDateTime heartbeatAt);
}
