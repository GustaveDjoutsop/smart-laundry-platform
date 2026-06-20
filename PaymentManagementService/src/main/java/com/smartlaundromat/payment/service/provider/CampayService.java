package com.smartlaundromat.payment.service.provider;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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
import org.springframework.web.reactive.function.client.WebClientResponseException;

import java.math.BigDecimal;
import java.util.Map;

@Service
@Slf4j
@RequiredArgsConstructor
public class CampayService extends PaymentProviderService {

    private final PaymentConfig paymentConfig;
    private final WebClient.Builder webClientBuilder;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Override
    public PaymentResponse requestPayment(String phoneNumber, BigDecimal amount, String description, String externalReference) {
        PaymentConfig.CampayConfig config = paymentConfig.getCampay();
        log.info("Initiating CamPay payment: phoneNumber={}, amount={}, description={}, externalReference={}",
                phoneNumber, amount, description, externalReference);

        if (!isConfigured()) {
            log.error("CamPay payment provider is not configured");
            throw new PaymentException("CAMPAY_NOT_CONFIGURED", "CamPay payment provider is not configured");
        }

        String formattedPhone = formatPhoneNumber(phoneNumber);

        try {
            log.info("Authenticating with CamPay to get access token");
            String token = getAccessToken(config);
            log.info("Access token obtained successfully");

            WebClient client = webClientBuilder.baseUrl(config.getBaseUrl()).build();

            Map<String, String> requestBody = Map.of(
                    "amount", amount.setScale(0, java.math.RoundingMode.HALF_UP).toPlainString(),
                    "currency", paymentConfig.getCurrency(),
                    "from", formattedPhone,
                    "description", description != null ? description : "Smart Laundry Payment",
                    "external_reference", externalReference
            );

            Map<?, ?> response = client.post()
                    .uri("/collect/")
                    .header("Authorization", "Token " + token)
                    .header("Content-Type", "application/json")
                    .bodyValue(requestBody)
                    .retrieve()
                    .bodyToMono(Map.class)
                    .block();

            String providerRef = response != null ? (String) response.get("reference") : null;

            log.info("CamPay payment initiated: ref={}, providerRef={}", externalReference, providerRef);

            return PaymentResponse.builder()
                    .success(true)
                    .externalReference(externalReference)
                    .providerReference(providerRef)
                    .provider(PaymentProvider.CAMPAY)
                    .status(PaymentStatus.PENDING)
                    .amount(amount)
                    .message("Payment request sent. Please confirm on your phone.")
                    .build();

        } catch (PaymentException e) {
            throw e;
        } catch (WebClientResponseException e) {
            String body = e.getResponseBodyAsString();
            log.error("CamPay payment failed: {} - {}", e.getMessage(), body);
            throw new PaymentException(buildErrorCode(body), mapCampayError(body));
        } catch (Exception e) {
            log.error("CamPay payment failed: {}", e.getMessage(), e);
            throw new PaymentException("CAMPAY_ERROR", mapCampayError(e.getMessage()));
        }
    }

    @Override
    public String getProviderName() {
        return "CAMPAY";
    }

    @Override
    public boolean isConfigured() {

        PaymentConfig.CampayConfig config = paymentConfig.getCampay();
        log.debug("Checking CamPay configuration: baseUrl={}, appKeySet={}, appSecretSet={}",
                config.getBaseUrl(),
                StringUtils.hasText(config.getAppKey()),
                StringUtils.hasText(config.getAppSecret()));

        return StringUtils.hasText(config.getAppKey())
                && StringUtils.hasText(config.getAppSecret());
    }

    private String getAccessToken(PaymentConfig.CampayConfig config) {
        WebClient client = webClientBuilder.baseUrl(config.getBaseUrl()).build();

        Map<?, ?> tokenResponse = client.post()
                .uri("/token/")
                .header("Content-Type", "application/json")
                .bodyValue(Map.of(
                        "username", config.getAppKey(),// CamPay uses "username" for the app key
                        "password", config.getAppSecret()// CamPay uses "password" for the app secret
                ))
                .retrieve()
                .bodyToMono(Map.class)
                .block();

        if (tokenResponse == null || !tokenResponse.containsKey("token")) {
            throw new PaymentException("CAMPAY_AUTH_FAILED", "Failed to authenticate with CamPay");
        }

        return (String) tokenResponse.get("token");
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
        if (cleaned.length() == 8) {
            return "2376" + cleaned;
        }

        return cleaned;
    }

    /**
     * Builds a PaymentException error code that preserves CamPay's original error_code
     * (e.g. "CAMPAY_ER102") so downstream consumers can localize the message themselves.
     * Falls back to "CAMPAY_ERROR" when the response body has no recognizable error_code.
     */
    private String buildErrorCode(String body) {
        String campayErrorCode = extractCampayErrorCode(body);
        return campayErrorCode != null ? "CAMPAY_" + campayErrorCode : "CAMPAY_ERROR";
    }

    private String extractCampayErrorCode(String body) {
        if (body == null || body.isBlank()) {
            return null;
        }
        try {
            JsonNode node = objectMapper.readTree(body);
            JsonNode errorCode = node.get("error_code");
            return errorCode != null ? errorCode.asText() : null;
        } catch (Exception e) {
            return null;
        }
    }

    private String mapCampayError(String errorMessage) {
        if (errorMessage == null) return "Payment failed";
        if (errorMessage.contains("ER102")) return "Only MTN Mobile Money or Orange Money accepted";
        if (errorMessage.contains("ER101")) return "Invalid phone number format";
        if (errorMessage.contains("ER103")) return "Insufficient funds";
        if (errorMessage.contains("ER104")) return "Daily transaction limit exceeded";
        if (errorMessage.contains("ER105")) return "Mobile money account not activated";
        if (errorMessage.contains("ER106")) return "Payment declined";
        return "Payment failed: " + errorMessage;
    }
}
