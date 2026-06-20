package com.smartlaundromat.machine.repository;

import com.smartlaundromat.machine.model.Machine;
import com.smartlaundromat.machine.model.enums.MachineStatus;
import com.smartlaundromat.machine.model.enums.MachineType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Repository
public interface MachineRepository extends JpaRepository<Machine, Long> {

    Optional<Machine> findByMachineId(String machineId);

    List<Machine> findByType(MachineType type);

    List<Machine> findByStatus(MachineStatus status);

    List<Machine> findByIsOnline(boolean isOnline);

    List<Machine> findByLastHeartbeatBefore(LocalDateTime before);

    boolean existsByMachineId(String machineId);
}
