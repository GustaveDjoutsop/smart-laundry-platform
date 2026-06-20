package com.smartlaundromat.payment.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.math.BigDecimal;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TransactionDebitResponse {

    private boolean success;
    private String transactionReference;
    private String cardUid;
    private String machineId;
    private BigDecimal amountDebited;
    private BigDecimal remainingBalance;
    private Integer pulseCount;
    private Integer cycleDuration;
    private String message;
}
