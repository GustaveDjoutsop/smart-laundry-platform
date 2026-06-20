package com.smartlaundromat.machine.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data
public class StartCycleRequest {

    @NotBlank(message = "Machine ID is required")
    private String machineId;

    @NotBlank(message = "Cycle type is required")
    private String cycleType;

    @NotNull(message = "Duration is required")
    private Integer durationMinutes;

    @NotNull(message = "Pulse count is required")
    private Integer pulseCount;

    private String rfidCardUid;
    private String transactionReference;

    /**
     * Reservation code, required only when the target machine is currently held by an
     * active reservation (and the reservation feature is enabled). Cross-checked by
     * code + machine — not by user.
     */
    private String reservationCode;
}
