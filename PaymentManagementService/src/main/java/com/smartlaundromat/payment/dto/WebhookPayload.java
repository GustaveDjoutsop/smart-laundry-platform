package com.smartlaundromat.payment.dto;

import com.fasterxml.jackson.annotation.JsonAlias;
import lombok.Data;
import java.util.Map;

@Data
public class WebhookPayload {

    private String reference;

    // CamPay sends "external_reference"; MTN/Orange send "externalId".
    @JsonAlias({"external_reference", "externalId"})
    private String externalReference;

    private String status;
    private String amount;
    private String financialTransactionId;
    private String reason;
    private Map<String, Object> additionalData;
}
