package com.botmanager.core.payment;

import java.util.Map;

public interface PaymentGateway {

    PaymentResult initiatePayment(PaymentRequest request);

    PaymentStatus checkStatus(String botId, String provider, String transactionId);

    PaymentResult handleWebhook(String botId, String providerName, Map<String, Object> payload);

}
