package com.smartlaundromat.payment.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class RfidBalanceCheckRequest {

    @NotBlank(message = "Card UID is required")
    private String cardUid;
}
