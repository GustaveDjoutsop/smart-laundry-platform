package com.botmanager.core.payment;

import java.util.Map;

public abstract class PaymentGateway {

    public abstract PaymentResult initiatePayment(PaymentRequest request);

    public abstract PaymentStatus checkStatus(String botId, String provider, String transactionId);

    public abstract PaymentResult handleWebhook(String botId, String providerName, Map<String, Object> payload);

}
