package com.smartlaundromat.payment.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

public record PricingUpdateRequest(
        @NotNull @Min(1) Integer amount
) {
}
