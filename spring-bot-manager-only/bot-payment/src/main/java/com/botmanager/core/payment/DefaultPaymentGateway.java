package com.botmanager.core.payment;

import com.botmanager.config.MicroserviceProperties;
import io.github.resilience4j.bulkhead.Bulkhead;
import io.github.resilience4j.bulkhead.BulkheadRegistry;
import io.github.resilience4j.circuitbreaker.CircuitBreaker;
import io.github.resilience4j.circuitbreaker.CircuitBreakerRegistry;
import io.github.resilience4j.retry.Retry;
import io.github.resilience4j.retry.RetryRegistry;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.function.Supplier;

@Slf4j
@Component
@RequiredArgsConstructor
public class DefaultPaymentGateway extends PaymentGateway {

    @Autowired
    @Qualifier("microserviceWebClient")
    private WebClient webClient;

    private final MicroserviceProperties microserviceProperties;

    private final PaymentStore paymentStore;

    private final PaymentEventPublisher paymentEventPublisher;

    private final CircuitBreakerRegistry circuitBreakerRegistry;

    private final BulkheadRegistry bulkheadRegistry;

    private final RetryRegistry retryRegistry;

    private <T> T callPaymentService(Supplier<T> call) {
        Supplier<T> decorated = Bulkhead.decorateSupplier(
                bulkheadRegistry.bulkhead("paymentService"), call);
        decorated = CircuitBreaker.decorateSupplier(
                circuitBreakerRegistry.circuitBreaker("paymentService"), decorated);
        return decorated.get();
    }

    private <T> T callPaymentServiceRead(Supplier<T> call) {
        Supplier<T> decorated = Bulkhead.decorateSupplier(
                bulkheadRegistry.bulkhead("paymentService"), call);
        decorated = CircuitBreaker.decorateSupplier(
                circuitBreakerRegistry.circuitBreaker("paymentService"), decorated);
        decorated = Retry.decorateSupplier(
                retryRegistry.retry("paymentServiceRead"), decorated);
        return decorated.get();
    }

    @Override
    public PaymentResult initiatePayment(PaymentRequest request) {
        String url = microserviceProperties.getPaymentServiceUrl() + "/api/payments/initiate";
        log.info("Initiating payment for botId={}, phoneNumber={}, amount={}, provider={}",
                request.botId(), request.phoneNumber(), request.amount(), resolveProvider(request.phoneNumber()));

        try {
            Map<String, Object> body = new HashMap<>();
            body.put("phoneNumber", request.phoneNumber());
            body.put("amount", request.amount());
            body.put("machineId", extractMachineId(request));
            body.put("pulseCount", extractPulseCount(request));
            body.put("cycleDuration", extractCycleDuration(request));
            body.put("provider", resolveProvider(request.phoneNumber()));
            body.put("description", request.description());

            log.debug("Payment initiation request body: {}", body);

            Map<String, Object> responseBody = callPaymentService(() -> webClient.post()
                    .uri(url)
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(body)
                    .retrieve()
                    .bodyToMono(new ParameterizedTypeReference<Map<String, Object>>() {})
                    .block());

            if (responseBody != null) {
                boolean success = Boolean.TRUE.equals(responseBody.get("success"));
                String externalRef = (String) responseBody.get("externalReference");
                String providerRef = (String) responseBody.get("providerReference");
                String status = (String) responseBody.get("status");

                PaymentResult result = PaymentResult.builder()
                        .success(success)
                        .transactionId(providerRef)
                        .externalRef(externalRef)
                        .status(PaymentStatus.fromValue(status))
                        .raw(responseBody)
                        .build();

                if (success) {
                    PaymentRecord record = PaymentRecord.builder()
                            .botId(request.botId())
                            .provider(resolveProvider(request.phoneNumber()))
                            .transactionId(externalRef)
                            .externalRef(externalRef)
                            .customerPhone(request.phoneNumber())
                            .amount(request.amount())
                            .currency(request.currency())
                            .status(PaymentStatus.fromValue(status))
                            .metadata(request.metadata())
                            .createdAt(Instant.now())
                            .raw(responseBody)
                            .build();

                    paymentStore.upsertPayment(record);
                    paymentEventPublisher.publishInitiated(record);
                }

                return result;
            }

            return PaymentResult.builder()
                    .success(false)
                    .errorMessage("Payment service returned empty response")
                    .build();

        } catch (WebClientResponseException exception) {
            String responseBody = exception.getResponseBodyAsString();
            log.error("Failed to initiate payment via PaymentManagementService: {} - {}",
                    exception.getMessage(), responseBody);

            return PaymentResult.builder()
                    .success(false)
                    .errorMessage(responseBody != null && !responseBody.isBlank() ? responseBody : exception.getMessage())
                    .build();
        } catch (Exception exception) {
            log.error("Failed to initiate payment via PaymentManagementService: {}", exception.getMessage());

            return PaymentResult.builder()
                    .success(false)
                    .errorMessage(exception.getMessage())
                    .build();
        }
    }

    @Override
    public PaymentStatus checkStatus(String botId, String provider, String transactionId) {
        String url = microserviceProperties.getPaymentServiceUrl()
                + "/api/payments/transaction/" + transactionId;

        try {
            Map<String, Object> response = callPaymentServiceRead(() -> webClient.get()
                    .uri(url)
                    .retrieve()
                    .bodyToMono(new ParameterizedTypeReference<Map<String, Object>>() {})
                    .block());

            if (response != null) {
                return PaymentStatus.fromValue((String) response.get("status"));
            }
            return PaymentStatus.PENDING;
        } catch (Exception exception) {
            log.error("Failed to check payment status: {}", exception.getMessage());
            return PaymentStatus.PENDING;
        }
    }

    @Override
    public PaymentResult handleWebhook(String botId, String providerName, Map<String, Object> payload) {
        String webhookUrl = microserviceProperties.getPaymentServiceUrl()
                + "/api/webhook/" + providerName;

        try {
            callPaymentService(() -> webClient.post()
                    .uri(webhookUrl)
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(payload)
                    .retrieve()
                    .toBodilessEntity()
                    .block());

            String externalRef = (String) payload.get("external_reference");
            if (externalRef == null) {
                externalRef = (String) payload.get("externalId");
            }

            String transactionId = (String) payload.get("reference");
            String status = (String) payload.get("status");
            if (status == null) {
                status = (String) payload.get("state");
            }

            PaymentResult result = PaymentResult.builder()
                    .success(true)
                    .transactionId(transactionId)
                    .externalRef(externalRef)
                    .status(PaymentStatus.fromValue(status))
                    .raw(payload)
                    .build();

            if (result.transactionId() != null) {
                paymentStore.getPayment(botId, result.transactionId())
                        .or(() -> paymentStore.getPaymentByExternalRef(botId, result.externalRef()))
                        .ifPresent(record -> {
                            record.setStatus(result.status());
                            record.setRaw(result.raw());
                            paymentStore.upsertPayment(record);
                            paymentEventPublisher.publishStatusUpdate(record);
                        });
            }

            return result;
        } catch (Exception exception) {
            log.error("Failed to forward webhook to PaymentManagementService: {}", exception.getMessage());

            return PaymentResult.builder()
                    .success(false)
                    .errorMessage(exception.getMessage())
                    .build();
        }
    }

    private String extractMachineId(PaymentRequest request) {
        if (request.metadata() != null && request.metadata().containsKey("machineId")) {
            return (String) request.metadata().get("machineId");
        }
        return "unknown";
    }

    private int extractPulseCount(PaymentRequest request) {
        if (request.metadata() != null && request.metadata().containsKey("pulseCount")) {
            return ((Number) request.metadata().get("pulseCount")).intValue();
        }
        return 1;
    }

    private int extractCycleDuration(PaymentRequest request) {
        if (request.metadata() != null && request.metadata().containsKey("duration")) {
            return ((Number) request.metadata().get("duration")).intValue();
        }
        return 30;
    }

    private String resolveProvider(String phoneNumber) {
        if (phoneNumber == null) return "CAMPAY";
        String cleaned = phoneNumber.replaceAll("[^0-9]", "");
        if (cleaned.startsWith("237")) {
            cleaned = cleaned.substring(3);
        }
        if (cleaned.startsWith("69") || cleaned.startsWith("65")) {
            return "ORANGE_MONEY";
        }
        return "CAMPAY";
    }

}
