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
public class RfidBalanceResponse {

    private String cardUid;
    private String ownerName;
    private BigDecimal balance;
    private String currency;
    private boolean sufficient;
    private String message;
}
