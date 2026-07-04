package com.smartlaundromat.machine.simulator;

import com.smartlaundromat.machine.config.MachineConfig;
import com.smartlaundromat.machine.dto.TelemetryPayload;
import com.smartlaundromat.machine.model.Machine;
import com.smartlaundromat.machine.model.enums.MachineStatus;
import com.smartlaundromat.machine.model.enums.MachineType;
import com.smartlaundromat.machine.repository.MachineRepository;
import com.smartlaundromat.machine.service.MachineService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.List;

/**
 * Drives simulated machine state in dev when {@code simulator.enabled=true}.
 * <p>
 * Two scheduled tasks:
 * <ol>
 *   <li><b>Heartbeat</b> (every {@code heartbeatIntervalMs}) — marks every non-RUNNING machine
 *       ONLINE by calling {@code processTelemetry()} with a minimal idle payload. This makes all
 *       machines show as AVAILABLE to the bot and dashboard within seconds of startup.</li>
 *   <li><b>Progress update</b> (every {@code telemetryUpdateIntervalMs}) — for each RUNNING
 *       machine, computes the elapsed-time-based progress and sends a realistic telemetry
 *       payload (temperature, spin speed, door locked). The actual RUNNING → FINISHED
 *       transition is handled by the existing {@link com.smartlaundromat.machine.service.CycleMonitorService}.</li>
 * </ol>
 */
@Service
@Slf4j
@RequiredArgsConstructor
@ConditionalOnProperty(name = "simulator.enabled", havingValue = "true")
public class SimulatorHeartbeatService {

    private final MachineService machineService;
    private final MachineRepository machineRepository;
    private final MachineConfig machineConfig;

    @Scheduled(fixedDelayString = "${simulator.heartbeat-interval-ms:5000}")
    void sendHeartbeats() {
        for (String machineId : machineConfig.getAvailableIds()) {
            machineRepository.findByMachineId(machineId).ifPresent(machine -> {
                if (machine.getStatus() != MachineStatus.RUNNING) {
                    machineService.processTelemetry(buildIdleTelemetry(machine));
                }
            });
        }
        log.debug("[SIMULATOR] Heartbeat sent to {} machines", machineConfig.getAvailableIds().size());
    }

    @Scheduled(fixedDelayString = "${simulator.telemetry-update-interval-ms:10000}")
    void updateRunningMachines() {
        List<Machine> running = machineRepository.findByStatus(MachineStatus.RUNNING);
        for (Machine machine : running) {
            machineService.processTelemetry(buildRunningTelemetry(machine));
        }
        if (!running.isEmpty()) {
            log.debug("[SIMULATOR] Progress update sent to {} running machines", running.size());
        }
    }

    TelemetryPayload buildIdleTelemetry(Machine machine) {
        TelemetryPayload t = new TelemetryPayload();
        t.setMachineId(machine.getMachineId());
        // Preserve FINISHED status so CycleMonitorService can reset it; everything else → IDLE
        t.setStatus(machine.getStatus() == MachineStatus.FINISHED ? "FINISHED" : "IDLE");
        t.setDoorLocked(false);
        t.setTemperature(idleTemperature(machine));
        t.setHumidity(50.0 + Math.random() * 10);
        t.setSpinSpeed(0);
        t.setPowerConsumption(machine.getType() == MachineType.DRYER ? 50.0 : 20.0);
        return t;
    }

    TelemetryPayload buildRunningTelemetry(Machine machine) {
        int progress = computeProgress(machine);
        TelemetryPayload t = new TelemetryPayload();
        t.setMachineId(machine.getMachineId());
        t.setStatus("RUNNING");
        t.setCycleProgress(progress);
        t.setDoorLocked(true);
        t.setTemperature(runningTemperature(machine, progress));
        t.setHumidity(60.0 + progress * 0.2);
        t.setSpinSpeed(runningSpinSpeed(machine, progress));
        t.setPowerConsumption(machine.getType() == MachineType.DRYER ? 2000.0 : 800.0 + progress * 5);
        t.setVibration(machine.getType() == MachineType.WASHER && progress > 80 ? 2.5 + Math.random() : 0.5);
        return t;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    int computeProgress(Machine machine) {
        if (machine.getCycleStartedAt() == null || machine.getCycleEndsAt() == null) {
            return 0;
        }
        long totalSeconds = ChronoUnit.SECONDS.between(machine.getCycleStartedAt(), machine.getCycleEndsAt());
        if (totalSeconds <= 0) return 100;
        long elapsedSeconds = ChronoUnit.SECONDS.between(machine.getCycleStartedAt(), LocalDateTime.now());
        return (int) Math.min(99, Math.max(0, (elapsedSeconds * 100) / totalSeconds));
    }

    private double idleTemperature(Machine machine) {
        return machine.getType() == MachineType.DRYER
                ? 25.0 + Math.random() * 5
                : 22.0 + Math.random() * 2;
    }

    private double runningTemperature(Machine machine, int progress) {
        return machine.getType() == MachineType.WASHER
                ? 22.0 + progress * 0.6     // washer heats from 22° to ~82°
                : 25.0 + progress * 0.9;     // dryer heats from 25° to ~115°
    }

    private int runningSpinSpeed(Machine machine, int progress) {
        if (machine.getType() == MachineType.DRYER) return 0;
        // Washer: slow at start/fill, fast in the middle, slow at rinse end
        if (progress < 20) return 50;
        if (progress < 70) return 800;
        if (progress > 85) return 1200;
        return 500;
    }
}
