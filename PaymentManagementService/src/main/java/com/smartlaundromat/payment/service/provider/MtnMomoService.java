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
import java.util.UUID;

@Service
@Slf4j
@RequiredArgsConstructor
public class MtnMomoService extends PaymentProviderService {

    private final PaymentConfig paymentConfig;
    private final WebClient.Builder webClientBuilder;

    private String cachedToken;
    private Instant tokenExpiry;

    @Override
    public PaymentResponse requestPayment(String phoneNumber, BigDecimal amount, String description, String externalReference) {
        PaymentConfig.MtnConfig config = paymentConfig.getMtn();

        if (!isConfigured()) {
            throw new PaymentException("MTN_NOT_CONFIGURED", "MTN MoMo payment provider is not configured");
        }

        String formattedPhone = formatPhoneNumber(phoneNumber);
        String referenceId = UUID.randomUUID().toString();

        try {
            String token = getAccessToken(config);

            String currency = "sandbox".equals(config.getEnvironment()) ? "EUR" : "XAF";

            WebClient client = webClientBuilder.baseUrl(config.getApiUrl()).build();

            Map<String, Object> requestBody = Map.of(
                    "amount", amount.toPlainString(),
                    "currency", currency,
                    "externalId", externalReference,
                    "payer", Map.of(
                            "partyIdType", "MSISDN",
                            "partyId", formattedPhone
                    ),
                    "payerMessage", description != null ? description : "Smart Laundry Payment",
                    "payeeNote", "Smart Laundry - Payment"
            );

            client.post()
                    .uri("/collection/v1_0/requesttopay")
                    .header("Authorization", "Bearer " + token)
                    .header("X-Reference-Id", referenceId)
                    .header("X-Target-Environment", config.getEnvironment())
                    .header("Ocp-Apim-Subscription-Key", config.getSubscriptionKey())
                    .header("Content-Type", "application/json")
                    .bodyValue(requestBody)
                    .retrieve()
                    .toBodilessEntity()
                    .block();

            log.info("MTN MoMo payment initiated: ref={}, mtnRef={}", externalReference, referenceId);

            return PaymentResponse.builder()
                    .success(true)
                    .externalReference(externalReference)
                    .providerReference(referenceId)
                    .provider(PaymentProvider.MTN)
                    .status(PaymentStatus.PENDING)
                    .amount(amount)
                    .message("Payment request sent. Please confirm on your phone.")
                    .build();

        } catch (PaymentException e) {
            throw e;
        } catch (Exception e) {
            log.error("MTN MoMo payment failed: {}", e.getMessage(), e);
            throw new PaymentException("MTN_ERROR", mapMtnError(e.getMessage()));
        }
    }

    public Map<?, ?> checkPaymentStatus(String referenceId) {
        PaymentConfig.MtnConfig config = paymentConfig.getMtn();
        String token = getAccessToken(config);

        WebClient client = webClientBuilder.baseUrl(config.getApiUrl()).build();

        return client.get()
                .uri("/collection/v1_0/requesttopay/{referenceId}", referenceId)
                .header("Authorization", "Bearer " + token)
                .header("X-Target-Environment", config.getEnvironment())
                .header("Ocp-Apim-Subscription-Key", config.getSubscriptionKey())
                .retrieve()
                .bodyToMono(Map.class)
                .block();
    }

    @Override
    public String getProviderName() {
        return "MTN";
    }

    @Override
    public boolean isConfigured() {
        PaymentConfig.MtnConfig config = paymentConfig.getMtn();
        return StringUtils.hasText(config.getSubscriptionKey())
                && StringUtils.hasText(config.getApiUserId())
                && StringUtils.hasText(config.getApiKey());
    }

    private synchronized String getAccessToken(PaymentConfig.MtnConfig config) {
        if (cachedToken != null && tokenExpiry != null && Instant.now().isBefore(tokenExpiry)) {
            return cachedToken;
        }

        String credentials = Base64.getEncoder().encodeToString(
                (config.getApiUserId() + ":" + config.getApiKey()).getBytes(StandardCharsets.UTF_8)
        );

        WebClient client = webClientBuilder.baseUrl(config.getApiUrl()).build();

        Map<?, ?> tokenResponse = client.post()
                .uri("/collection/token/")
                .header("Authorization", "Basic " + credentials)
                .header("Ocp-Apim-Subscription-Key", config.getSubscriptionKey())
                .retrieve()
                .bodyToMono(Map.class)
                .block();

        if (tokenResponse == null || !tokenResponse.containsKey("access_token")) {
            throw new PaymentException("MTN_AUTH_FAILED", "Failed to authenticate with MTN MoMo");
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

    private String mapMtnError(String errorMessage) {
        if (errorMessage == null) return "Payment failed";
        if (errorMessage.contains("PAYER_NOT_FOUND")) return "Phone not registered with MTN Mobile Money";
        if (errorMessage.contains("NOT_ALLOWED")) return "Transaction not allowed";
        if (errorMessage.contains("INVALID_CURRENCY")) return "Currency not supported";
        if (errorMessage.contains("PAYER_LIMIT_REACHED")) return "Daily transaction limit exceeded";
        if (errorMessage.contains("NOT_ENOUGH_FUNDS")) return "Insufficient funds in MTN account";
        return "Payment failed: " + errorMessage;
    }
}
