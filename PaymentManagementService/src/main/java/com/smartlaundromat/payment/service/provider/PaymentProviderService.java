package com.smartlaundromat.payment.service.provider;

import com.smartlaundromat.payment.dto.PaymentResponse;
import java.math.BigDecimal;

public abstract class PaymentProviderService {

    public abstract PaymentResponse requestPayment(String phoneNumber, BigDecimal amount, String description, String externalReference);

    public abstract String getProviderName();

    public abstract boolean isConfigured();
}
