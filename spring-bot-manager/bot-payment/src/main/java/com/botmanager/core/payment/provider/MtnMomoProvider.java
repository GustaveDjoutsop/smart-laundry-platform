package com.botmanager.core.payment.provider;

import com.botmanager.core.payment.PaymentRequest;
import com.botmanager.core.payment.PaymentResult;
import com.botmanager.core.payment.PaymentStatus;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.UUID;

@Slf4j
@Component
public class MtnMomoProvider extends PaymentProvider {

    @Override
    public String getName() {
        return "mtn";
    }

    @Override
    public PaymentResult initiatePayment(PaymentRequest request) {
        log.warn("MTN MoMo provider is a stub implementation");

        return PaymentResult.builder()
                .success(true)
                .transactionId(UUID.randomUUID().toString())
                .externalRef(request.reference())
                .status(PaymentStatus.PENDING)
                .build();
    }

    @Override
    public PaymentStatus checkStatus(String botId, String transactionId) {
        return PaymentStatus.PENDING;
    }

    @Override
    public PaymentResult handleWebhook(Map<String, Object> payload) {
        return PaymentResult.builder()
                .success(false)
                .errorMessage("MTN webhook not implemented")
                .build();
    }

}
