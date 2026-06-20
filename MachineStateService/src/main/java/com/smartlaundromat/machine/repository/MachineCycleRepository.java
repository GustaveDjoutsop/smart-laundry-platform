package com.smartlaundromat.machine.repository;

import com.smartlaundromat.machine.model.MachineCycle;
import com.smartlaundromat.machine.model.enums.CycleStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Repository
public interface MachineCycleRepository extends JpaRepository<MachineCycle, Long> {

    Optional<MachineCycle> findByMachineIdAndStatus(String machineId, CycleStatus status);

    List<MachineCycle> findByStatusAndEndsAtBefore(CycleStatus status, LocalDateTime before);

    List<MachineCycle> findByMachineIdOrderByCreatedAtDesc(String machineId);

    Optional<MachineCycle> findByTransactionReference(String transactionReference);
}
