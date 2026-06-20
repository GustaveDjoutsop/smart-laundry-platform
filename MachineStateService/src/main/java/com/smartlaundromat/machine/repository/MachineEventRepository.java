package com.smartlaundromat.machine.repository;

import com.smartlaundromat.machine.model.MachineEvent;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface MachineEventRepository extends JpaRepository<MachineEvent, Long> {

    List<MachineEvent> findByMachineIdOrderByCreatedAtDesc(String machineId);

    List<MachineEvent> findTop50ByMachineIdOrderByCreatedAtDesc(String machineId);
}
