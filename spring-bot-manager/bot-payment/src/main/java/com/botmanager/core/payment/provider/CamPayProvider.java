package com.botmanager.core.payment.provider;

import com.botmanager.config.CamPayProperties;
import com.botmanager.core.payment.PaymentRequest;
import com.botmanager.core.payment.PaymentResult;
import com.botmanager.core.payment.PaymentStatus;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.Map;

@Slf4j
@Component
@RequiredArgsConstructor
public class CamPayProvider extends PaymentProvider {

    private final CamPayProperties camPayProperties;

    private final RestTemplate restTemplate;

    private final ObjectMapper objectMapper;

    private final Environment environment;

    @Override
    public String getName() {
        return "campay";
    }

    public boolean hasAnyPerBotTokenConfigured() {
        return System.getenv().entrySet().stream()
                .anyMatch(e -> e.getKey() != null
                        && e.getKey().startsWith("CAMPAY_TOKEN_")
                        && e.getValue() != null
                        && !e.getValue().isBlank());
    }

    public boolean isConfiguredForBot(String botId) {
        String token = resolveToken(botId);
        return token != null && !token.isBlank();
    }

    @Override
    public PaymentResult initiatePayment(PaymentRequest request) {
        String botId = request != null ? request.botId() : null;
        String token = resolveToken(botId);
        if (token == null || token.isBlank()) {
            return PaymentResult.builder()
                    .success(false)
                    .errorMessage("CamPay not configured")
                    .build();
        }

        try {
            String url = resolveBaseUrl(botId) + resolveCollectPath(botId);

            Map<String, Object> payload = new HashMap<>();
            payload.put("amount", String.valueOf(request.amount()));
            payload.put("currency", request.currency());
            payload.put("from", request.phoneNumber());
            payload.put("description", request.description());
            payload.put("external_reference", request.reference());

            HttpHeaders headers = createHeaders(token, resolveAuthScheme(botId));
            HttpEntity<Map<String, Object>> entity = new HttpEntity<>(payload, headers);

            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.POST, entity, Map.class);

            if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                Map<String, Object> body = response.getBody();
                String transactionId = (String) body.get("reference");
                String status = (String) body.get("status");

                return PaymentResult.builder()
                        .success(true)
                        .transactionId(transactionId)
                        .externalRef(request.reference())
                        .status(PaymentStatus.fromValue(status))
                        .raw(body)
                        .build();
            }

            return PaymentResult.builder()
                    .success(false)
                    .errorMessage("CamPay request failed")
                    .build();
        } catch (Exception exception) {
            log.error("CamPay initiate payment failed: {}", exception.getMessage());

            return PaymentResult.builder()
                    .success(false)
                    .errorMessage(exception.getMessage())
                    .build();
        }
    }

    @Override
    public PaymentStatus checkStatus(String botId, String transactionId) {
        String token = resolveToken(botId);
        if (token == null || token.isBlank()) {
            return PaymentStatus.PENDING;
        }

        try {
            String url = resolveBaseUrl(botId) + resolveStatusPath(botId) + transactionId + "/";

            HttpHeaders headers = createHeaders(token, resolveAuthScheme(botId));
            HttpEntity<Void> entity = new HttpEntity<>(headers);

            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.GET, entity, Map.class);

            if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                Map<String, Object> body = response.getBody();
                String status = (String) body.get("status");

                if (status == null) {
                    status = (String) body.get("state");
                }

                return PaymentStatus.fromValue(status);
            }

            return PaymentStatus.PENDING;
        } catch (Exception exception) {
            log.error("CamPay check status failed for {}: {}", transactionId, exception.getMessage());

            return PaymentStatus.PENDING;
        }
    }

    @Override
    public PaymentResult handleWebhook(Map<String, Object> payload) {
        String transactionId = (String) payload.get("reference");
        String status = (String) payload.get("status");

        if (status == null) {
            status = (String) payload.get("state");
        }

        String externalRef = (String) payload.get("external_reference");

        return PaymentResult.builder()
                .success(true)
                .transactionId(transactionId)
                .externalRef(externalRef)
                .status(PaymentStatus.fromValue(status))
                .raw(payload)
                .build();
    }

    private HttpHeaders createHeaders(String token, String authScheme) {
        HttpHeaders headers = new HttpHeaders();
        String scheme = (authScheme == null || authScheme.isBlank()) ? camPayProperties.getAuthScheme() : authScheme;
        headers.set("Authorization", scheme + " " + token);
        headers.set("Content-Type", "application/json");
        headers.set("User-Agent", "Mozilla/5.0 (compatible; SpringBot/1.0)");
        headers.set("Accept", "application/json");

        return headers;
    }

    private String resolveToken(String botId) {
        if (botId != null && !botId.isBlank()) {
            String envKey = "CAMPAY_TOKEN_" + botId.toUpperCase().replace("-", "_");
            String token = environment.getProperty(envKey);
            if (token == null || token.isBlank()) {
                token = environment.getProperty("campay.token." + botId);
            }
            if (token != null && !token.isBlank()) {
                return token;
            }
        }

        return camPayProperties.getToken();
    }

    private String resolveBaseUrl(String botId) {
        if (botId != null && !botId.isBlank()) {
            String envKey = "CAMPAY_BASE_URL_" + botId.toUpperCase().replace("-", "_");
            String url = environment.getProperty(envKey);
            if (url == null || url.isBlank()) {
                url = environment.getProperty("campay.base-url." + botId);
            }
            if (url != null && !url.isBlank()) {
                return url;
            }
        }

        return camPayProperties.getBaseUrl();
    }

    private String resolveAuthScheme(String botId) {
        if (botId != null && !botId.isBlank()) {
            String envKey = "CAMPAY_AUTH_SCHEME_" + botId.toUpperCase().replace("-", "_");
            String scheme = environment.getProperty(envKey);
            if (scheme == null || scheme.isBlank()) {
                scheme = environment.getProperty("campay.auth-scheme." + botId);
            }
            if (scheme != null && !scheme.isBlank()) {
                return scheme;
            }
        }

        return camPayProperties.getAuthScheme();
    }

    private String resolveCollectPath(String botId) {
        if (botId != null && !botId.isBlank()) {
            String envKey = "CAMPAY_COLLECT_PATH_" + botId.toUpperCase().replace("-", "_");
            String path = environment.getProperty(envKey);
            if (path == null || path.isBlank()) {
                path = environment.getProperty("campay.collect-path." + botId);
            }
            if (path != null && !path.isBlank()) {
                return path;
            }
        }

        return camPayProperties.getCollectPath();
    }

    private String resolveStatusPath(String botId) {
        if (botId != null && !botId.isBlank()) {
            String envKey = "CAMPAY_STATUS_PATH_" + botId.toUpperCase().replace("-", "_");
            String path = environment.getProperty(envKey);
            if (path == null || path.isBlank()) {
                path = environment.getProperty("campay.status-path." + botId);
            }
            if (path != null && !path.isBlank()) {
                return path;
            }
        }

        return camPayProperties.getStatusPath();
    }

}
