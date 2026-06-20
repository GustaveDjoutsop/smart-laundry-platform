package com.smartlaundromat.machine.service;

import com.smartlaundromat.machine.config.MachineConfig;
import com.smartlaundromat.machine.model.Machine;
import com.smartlaundromat.machine.model.MachineCycle;
import com.smartlaundromat.machine.model.enums.CycleStatus;
import com.smartlaundromat.machine.model.enums.CycleType;
import com.smartlaundromat.machine.model.enums.MachineStatus;
import com.smartlaundromat.machine.repository.MachineCycleRepository;
import com.smartlaundromat.machine.repository.MachineRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;

@Service
@Slf4j
@RequiredArgsConstructor
public class CycleMonitorService {

    private final MachineCycleRepository machineCycleRepository;
    private final MachineRepository machineRepository;
    private final MachineConfig machineConfig;

    @Scheduled(fixedRateString = "${machine.cycle-check-interval-ms:60000}")
    @Transactional
    public void checkCompletedCycles() {
        List<MachineCycle> completedCycles = machineCycleRepository
                .findByStatusAndEndsAtBefore(CycleStatus.IN_PROGRESS, LocalDateTime.now());

        for (MachineCycle cycle : completedCycles) {
            cycle.setStatus(CycleStatus.COMPLETED);
            cycle.setCompletedAt(LocalDateTime.now());
            machineCycleRepository.save(cycle);

            machineRepository.findByMachineId(cycle.getMachineId()).ifPresent(machine -> {
                machine.setStatus(MachineStatus.FINISHED);
                machine.setCurrentCycleType(CycleType.NONE);
                machine.setCycleProgress(100);
                machine.setDoorLocked(false);
                machine.setTotalCycles(machine.getTotalCycles() + 1);
                machine.setCyclesSinceService(machine.getCyclesSinceService() + 1);
                machineRepository.save(machine);

                log.info("Cycle completed: machine={}, cycle={}, duration={}min",
                        cycle.getMachineId(), cycle.getCycleType(), cycle.getDurationMinutes());
            });
        }

        if (!completedCycles.isEmpty()) {
            log.info("Completed {} cycles", completedCycles.size());
        }
    }

    @Scheduled(fixedRate = 60000)
    @Transactional
    public void checkOfflineMachines() {
        LocalDateTime cutoff = LocalDateTime.now()
                .minusSeconds(machineConfig.getHeartbeatTimeoutSeconds());

        List<Machine> stale = machineRepository.findByLastHeartbeatBefore(cutoff);

        for (Machine machine : stale) {
            if (machine.getIsOnline()) {
                machine.setIsOnline(false);
                machine.setStatus(MachineStatus.OFFLINE);
                machineRepository.save(machine);
                log.warn("Machine went offline: {}", machine.getMachineId());
            }
        }
    }

    @Scheduled(fixedRate = 60000)
    @Transactional
    public void resetFinishedMachines() {
        List<Machine> finished = machineRepository.findByStatus(MachineStatus.FINISHED);

        for (Machine machine : finished) {
            if (machine.getCycleEndsAt() != null
                    && machine.getCycleEndsAt().plusMinutes(5).isBefore(LocalDateTime.now())) {
                machine.setStatus(MachineStatus.IDLE);
                machine.setCurrentCycleType(CycleType.NONE);
                machine.setCycleStartedAt(null);
                machine.setCycleDurationMinutes(null);
                machine.setCycleEndsAt(null);
                machine.setCycleProgress(0);
                machineRepository.save(machine);
                log.info("Machine reset to IDLE: {}", machine.getMachineId());
            }
        }
    }
}
