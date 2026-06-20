package com.smartlaundromat.machine.dto;

import lombok.Data;

@Data
public class TelemetryPayload {

    private String machineId;
    private String status;
    private String cycleType;
    private Integer cycleDurationMinutes;
    private Integer cycleProgress;
    private Double temperature;
    private Double humidity;
    private Double waterLevel;
    private Integer spinSpeed;
    private Double vibration;
    private Boolean doorLocked;
    private Double powerConsumption;
    private String errorCode;
    private String errorMessage;
    private Integer totalCycles;
    private String zone;
    private Integer position;
}
