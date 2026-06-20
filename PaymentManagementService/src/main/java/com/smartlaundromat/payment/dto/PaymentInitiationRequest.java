package com.smartlaundromat.payment.dto;

import com.smartlaundromat.payment.model.enums.PaymentProvider;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import lombok.Data;
import java.math.BigDecimal;

@Data
public class PaymentInitiationRequest {

    @NotBlank(message = "Phone number is required")
    private String phoneNumber;

    @NotNull(message = "Amount is required")
    @Positive(message = "Amount must be positive")
    private BigDecimal amount;

    @NotBlank(message = "Machine ID is required")
    private String machineId;

    @NotNull(message = "Pulse count is required")
    private Integer pulseCount;

    @NotNull(message = "Cycle duration is required")
    private Integer cycleDuration;

    @NotNull(message = "Payment provider is required")
    private PaymentProvider provider;

    private String description;
}
