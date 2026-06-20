package com.smartlaundromat.machine.client;

import com.smartlaundromat.machine.config.ReservationProperties;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * Fetches cycle/reservation pricing from PaymentManagementService GET /api/pricing.
 * The endpoint is permit-all so no auth token is required.
 * Results are cached in-process for 60 seconds; on any failure the
 * static {@code ReservationProperties.feeAmount} is used as fallback.
 */
@Slf4j
@Component
public class PricingClient {

    private static final long TTL_SECONDS = 60;

    private final RestTemplate restTemplate;
    private final String pricingUrl;
    private final ReservationProperties reservationProperties;

    private volatile List<Map<String, Object>> cached = null;
    private volatile Instant cacheTime = Instant.MIN;

    public PricingClient(RestTemplate restTemplate,
                         @Value("${payment-service.base-url:http://localhost:8081}") String pmsBaseUrl,
                         ReservationProperties reservationProperties) {
        this.restTemplate          = restTemplate;
        this.pricingUrl            = pmsBaseUrl + "/api/pricing";
        this.reservationProperties = reservationProperties;
    }

    public int getReservationFee() {
        return getAmount("reservation_fee", reservationProperties.getFeeAmount());
    }

    private int getAmount(String key, int fallback) {
        List<Map<String, Object>> entries = fetchCached();
        if (entries == null) return fallback;
        for (Map<String, Object> entry : entries) {
            if (key.equals(entry.get("key"))) {
                Object v = entry.get("amount");
                if (v instanceof Number n) return n.intValue();
            }
        }
        return fallback;
    }

    private List<Map<String, Object>> fetchCached() {
        if (cached != null && Instant.now().isBefore(cacheTime.plusSeconds(TTL_SECONDS))) {
            return cached;
        }
        try {
            ResponseEntity<List<Map<String, Object>>> resp = restTemplate.exchange(
                    pricingUrl,
                    HttpMethod.GET,
                    null,
                    new ParameterizedTypeReference<>() {});
            if (resp.getStatusCode().is2xxSuccessful() && resp.getBody() != null) {
                cached = resp.getBody();
                cacheTime = Instant.now();
                return cached;
            }
        } catch (Exception e) {
            log.warn("PricingClient: could not reach {} — using fallback feeAmount={}: {}",
                    pricingUrl, reservationProperties.getFeeAmount(), e.getMessage());
        }
        return null;
    }
}
