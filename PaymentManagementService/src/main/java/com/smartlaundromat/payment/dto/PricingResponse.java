package com.smartlaundromat.payment.dto;

import com.smartlaundromat.payment.model.Pricing;
import lombok.Builder;

import java.time.OffsetDateTime;

@Builder
public record PricingResponse(
        String key,
        int amount,
        String currency,
        String label,
        OffsetDateTime updatedAt,
        String updatedBy
) {
    public static PricingResponse from(Pricing p) {
        return PricingResponse.builder()
                .key(p.getKey())
                .amount(p.getAmount())
                .currency(p.getCurrency())
                .label(p.getLabel())
                .updatedAt(p.getUpdatedAt())
                .updatedBy(p.getUpdatedBy())
                .build();
    }
}
