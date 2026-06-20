package com.smartlaundromat.payment.service.provider;

import com.smartlaundromat.payment.config.PaymentConfig;
import com.smartlaundromat.payment.dto.PaymentResponse;
import com.smartlaundromat.payment.exception.PaymentException;
import com.smartlaundromat.payment.model.enums.PaymentProvider;
import com.smartlaundromat.payment.model.enums.PaymentStatus;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.reactive.function.client.WebClient;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;

@Service
@Slf4j
@RequiredArgsConstructor
public class OrangeMoneyService extends PaymentProviderService {

    private final PaymentConfig paymentConfig;
    private final WebClient.Builder webClientBuilder;

    private String cachedToken;
    private Instant tokenExpiry;

    @Override
    public PaymentResponse requestPayment(String phoneNumber, BigDecimal amount, String description, String externalReference) {
        PaymentConfig.OrangeConfig config = paymentConfig.getOrange();

        if (!isConfigured()) {
            throw new PaymentException("ORANGE_NOT_CONFIGURED", "Orange Money payment provider is not configured");
        }

        String formattedPhone = formatPhoneNumber(phoneNumber);

        try {
            String token = getAccessToken(config);

            WebClient client = webClientBuilder.baseUrl(config.getApiUrl()).build();

            Map<String, Object> orderInfo = Map.of(
                    "currency", paymentConfig.getCurrency(),
                    "amount", amount.toPlainString(),
                    "subscriberMsisdn", formattedPhone,
                    "description", description != null ? description : "Smart Laundry Payment",
                    "orderId", externalReference,
                    "notifUrl", "",
                    "merchantKey", config.getMerchantKey()
            );

            Map<?, ?> response = client.post()
                    .uri("/orange-money-webpay/dev/v1/webpayment")
                    .header("Authorization", "Bearer " + token)
                    .header("Content-Type", "application/json")
                    .bodyValue(orderInfo)
                    .retrieve()
                    .bodyToMono(Map.class)
                    .block();

            String payToken = response != null ? (String) response.get("pay_token") : null;

            log.info("Orange Money payment initiated: ref={}, payToken={}", externalReference, payToken);

            return PaymentResponse.builder()
                    .success(true)
                    .externalReference(externalReference)
                    .providerReference(payToken)
                    .provider(PaymentProvider.ORANGE_MONEY)
                    .status(PaymentStatus.PENDING)
                    .amount(amount)
                    .message("Payment request sent. Please confirm on your phone.")
                    .build();

        } catch (PaymentException e) {
            throw e;
        } catch (Exception e) {
            log.error("Orange Money payment failed: {}", e.getMessage(), e);
            throw new PaymentException("ORANGE_ERROR", "Orange Money payment failed: " + e.getMessage());
        }
    }

    @Override
    public String getProviderName() {
        return "ORANGE_MONEY";
    }

    @Override
    public boolean isConfigured() {
        PaymentConfig.OrangeConfig config = paymentConfig.getOrange();
        return StringUtils.hasText(config.getClientId())
                && StringUtils.hasText(config.getClientSecret())
                && StringUtils.hasText(config.getMerchantKey());
    }

    private synchronized String getAccessToken(PaymentConfig.OrangeConfig config) {
        if (cachedToken != null && tokenExpiry != null && Instant.now().isBefore(tokenExpiry)) {
            return cachedToken;
        }

        String credentials = Base64.getEncoder().encodeToString(
                (config.getClientId() + ":" + config.getClientSecret()).getBytes(StandardCharsets.UTF_8)
        );

        WebClient client = webClientBuilder.baseUrl(config.getApiUrl()).build();

        Map<?, ?> tokenResponse = client.post()
                .uri("/oauth/v3/token")
                .header("Authorization", "Basic " + credentials)
                .header("Content-Type", "application/x-www-form-urlencoded")
                .bodyValue("grant_type=client_credentials")
                .retrieve()
                .bodyToMono(Map.class)
                .block();

        if (tokenResponse == null || !tokenResponse.containsKey("access_token")) {
            throw new PaymentException("ORANGE_AUTH_FAILED", "Failed to authenticate with Orange Money");
        }

        cachedToken = (String) tokenResponse.get("access_token");
        int expiresIn = tokenResponse.containsKey("expires_in")
                ? ((Number) tokenResponse.get("expires_in")).intValue()
                : 3600;
        tokenExpiry = Instant.now().plusSeconds(expiresIn - 60);

        return cachedToken;
    }

    String formatPhoneNumber(String phone) {
        String cleaned = phone.replaceAll("[^0-9]", "");

        if (cleaned.startsWith("237") && cleaned.length() == 12) {
            return cleaned;
        }
        if (cleaned.startsWith("0") && cleaned.length() == 10) {
            return "237" + cleaned.substring(1);
        }
        if (cleaned.length() == 9 && cleaned.startsWith("6")) {
            return "237" + cleaned;
        }

        return cleaned;
    }
}
