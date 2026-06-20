package com.botmanager.core.payment;

import com.botmanager.config.CamPayProperties;
import com.botmanager.core.payment.provider.CamPayProvider;
import com.botmanager.core.payment.provider.MtnMomoProvider;
import com.botmanager.core.payment.provider.PaymentProvider;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;

@Slf4j
@Component
@RequiredArgsConstructor
public class DefaultPaymentGateway implements PaymentGateway {

    private final CamPayProvider camPayProvider;

    private final MtnMomoProvider mtnMomoProvider;

    private final CamPayProperties camPayProperties;

    private final PaymentStore paymentStore;

    private final PaymentEventPublisher paymentEventPublisher;

    private final Map<String, PaymentProvider> providers = new HashMap<>();

    private String defaultProvider;

    @PostConstruct
    void init() {
        providers.put(camPayProvider.getName(), camPayProvider);
        if (camPayProperties.isConfigured() || camPayProvider.hasAnyPerBotTokenConfigured()) {
            defaultProvider = camPayProvider.getName();
        }

        log.info("CamPay provider registered");

        providers.put(mtnMomoProvider.getName(), mtnMomoProvider);

        if (defaultProvider == null) {
            defaultProvider = mtnMomoProvider.getName();
        }

        log.info("Payment gateway initialized with {} providers", providers.size());
    }

    public PaymentResult initiatePayment(PaymentRequest request) {
        PaymentProvider provider = providers.get(defaultProvider);
        if (provider == mtnMomoProvider && request != null && camPayProvider.isConfiguredForBot(request.botId())) {
            provider = camPayProvider;
        }
        if (provider == null) {
            return PaymentResult.builder()
                    .success(false)
                    .errorMessage("No payment provider available")
                    .build();
        }

        PaymentResult result = provider.initiatePayment(request);

        if (result.success()) {
            PaymentRecord record = PaymentRecord.builder()
                    .botId(request.botId())
                    .provider(provider.getName())
                    .transactionId(result.transactionId())
                    .externalRef(result.externalRef())
                    .customerPhone(request.phoneNumber())
                    .amount(request.amount())
                    .currency(request.currency())
                    .status(result.status())
                    .metadata(request.metadata())
                    .createdAt(Instant.now())
                    .raw(result.raw())
                    .build();

            paymentStore.upsertPayment(record);
            paymentEventPublisher.publishInitiated(record);
        }

        return result;
    }

    public PaymentStatus checkStatus(String botId, String provider, String transactionId) {
        PaymentProvider paymentProvider = providers.get(provider);
        if (paymentProvider == null) {
            return PaymentStatus.PENDING;
        }

        return paymentProvider.checkStatus(botId, transactionId);
    }

    public PaymentResult handleWebhook(String botId, String providerName, Map<String, Object> payload) {
        PaymentProvider provider = providers.get(providerName);
        if (provider == null) {
            return PaymentResult.builder()
                    .success(false)
                    .errorMessage("Unknown provider: " + providerName)
                    .build();
        }

        PaymentResult result = provider.handleWebhook(payload);

        if (result.success() && result.transactionId() != null) {
            paymentStore.getPayment(botId, result.transactionId())
                    .ifPresent(record -> {
                        record.setStatus(result.status());
                        record.setRaw(result.raw());
                        paymentStore.upsertPayment(record);
                        paymentEventPublisher.publishStatusUpdate(record);
                    });
        }

        return result;
    }

}
