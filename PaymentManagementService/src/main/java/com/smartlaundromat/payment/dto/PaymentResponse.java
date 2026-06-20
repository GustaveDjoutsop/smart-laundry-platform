package com.smartlaundromat.payment.dto;

import com.smartlaundromat.payment.model.enums.PaymentProvider;
import com.smartlaundromat.payment.model.enums.PaymentStatus;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.math.BigDecimal;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PaymentResponse {

    private boolean success;
    private String externalReference;
    private String providerReference;
    private PaymentProvider provider;
    private PaymentStatus status;
    private BigDecimal amount;
    private String message;
}
