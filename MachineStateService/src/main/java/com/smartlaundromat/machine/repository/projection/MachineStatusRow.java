package com.smartlaundromat.machine.repository.projection;

import com.smartlaundromat.machine.model.MachineDisplay;
import com.smartlaundromat.machine.model.enums.CycleType;
import com.smartlaundromat.machine.model.enums.MachineStatus;
import com.smartlaundromat.machine.model.enums.MachineType;

import java.time.LocalDateTime;

/**
 * The 13 machine columns the status endpoints actually render, in place of the full 30-column
 * entity. The machine list is read far more often than it is written, so narrowing this one
 * query is the difference between shipping every row's brand, model, maintenance counters and
 * zone on each poll and shipping only what the caller displays.
 */
public record MachineStatusRow(
        String machineId,
        MachineType type,
        MachineStatus status,
        Boolean isOnline,
        Boolean doorLocked,
        CycleType currentCycleType,
        LocalDateTime cycleStartedAt,
        LocalDateTime cycleEndsAt,
        Integer cycleProgress,
        Double temperature,
        String errorCode,
        String errorMessage,
        LocalDateTime lastHeartbeat) {

    public boolean available() {
        return MachineDisplay.isAvailable(status, isOnline, doorLocked);
    }

    public String displayName() {
        return MachineDisplay.displayName(type, machineId);
    }
}
