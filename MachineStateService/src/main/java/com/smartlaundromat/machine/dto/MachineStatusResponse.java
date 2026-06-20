package com.smartlaundromat.machine.dto;

import com.smartlaundromat.machine.model.enums.CycleType;
import com.smartlaundromat.machine.model.enums.MachineStatus;
import com.smartlaundromat.machine.model.enums.MachineType;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class MachineStatusResponse {

    private String machineId;
    private String displayName;
    private MachineType type;
    private MachineStatus status;
    private boolean online;
    private boolean available;

    private CycleType currentCycleType;
    private LocalDateTime cycleStartedAt;
    private LocalDateTime cycleEndsAt;
    private Integer cycleProgress;
    private Integer remainingMinutes;

    private Boolean doorLocked;
    private Double temperature;

    private String errorCode;
    private String errorMessage;

    private LocalDateTime lastHeartbeat;
}
