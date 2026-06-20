package com.smartlaundromat.payment.dto;

import com.smartlaundromat.payment.model.enums.PaymentStatus;
import com.smartlaundromat.payment.model.enums.TopUpChannel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.math.BigDecimal;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TopUpResponse {

    private String reference;
    private String cardUid;
    private BigDecimal amount;
    private String currency;
    private TopUpChannel channel;
    private PaymentStatus status;
    private BigDecimal newBalance;
    private String message;
}
