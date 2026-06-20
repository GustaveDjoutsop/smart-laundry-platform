package com.smartlaundromat.payment.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import lombok.Data;
import java.math.BigDecimal;

@Data
public class RfidDebitRequest {

    @NotBlank(message = "Card UID is required")
    private String cardUid;

    @NotNull(message = "Amount is required")
    @Positive(message = "Amount must be positive")
    private BigDecimal amount;

    @NotBlank(message = "Machine ID is required")
    private String machineId;

    @NotNull(message = "Pulse count is required")
    private Integer pulseCount;

    @NotNull(message = "Cycle duration is required")
    private Integer cycleDuration;

    private String description;
}
