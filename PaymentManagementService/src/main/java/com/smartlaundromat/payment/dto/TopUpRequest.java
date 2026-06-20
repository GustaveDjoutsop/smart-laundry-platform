package com.smartlaundromat.payment.dto;

import com.smartlaundromat.payment.model.enums.TopUpChannel;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import lombok.Data;
import java.math.BigDecimal;

@Data
public class TopUpRequest {

    @NotBlank(message = "Card UID is required")
    private String cardUid;

    @NotNull(message = "Amount is required")
    @Positive(message = "Amount must be positive")
    private BigDecimal amount;

    @NotNull(message = "Channel is required")
    private TopUpChannel channel;

    private String phoneNumber;
}
