package com.botmanager.core.payment.provider;

import com.botmanager.core.payment.PaymentRequest;
import com.botmanager.core.payment.PaymentResult;
import com.botmanager.core.payment.PaymentStatus;

import java.util.Map;

public abstract class PaymentProvider {

    public abstract String getName();

    public abstract PaymentResult initiatePayment(PaymentRequest request);

    public abstract PaymentStatus checkStatus(String botId, String transactionId);

    public abstract PaymentResult handleWebhook(Map<String, Object> payload);

}
