package com.smartlaundromat.machine.repository;

import com.smartlaundromat.machine.model.Machine;
import com.smartlaundromat.machine.model.enums.MachineStatus;
import com.smartlaundromat.machine.model.enums.MachineType;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
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

    List<Machine> findByIsOnline(boolean isOnline);

    List<Machine> findByLastHeartbeatBefore(LocalDateTime before);

    boolean existsByMachineId(String machineId);
}
