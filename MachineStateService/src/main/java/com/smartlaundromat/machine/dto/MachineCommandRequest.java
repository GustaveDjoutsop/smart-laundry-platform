package com.smartlaundromat.machine.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class MachineCommandRequest {

    @NotBlank(message = "Machine ID is required")
    private String machineId;

    @NotBlank(message = "Action is required")
    private String action;

    @Min(1)
    @Max(10)
    private Integer pulseCount;

    private String cycleType;
    private Integer cycleDurationMinutes;
    private String rfidCardUid;
    private String transactionReference;
}
