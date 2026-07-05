package com.botmanager.bots.laundry;

import lombok.extern.slf4j.Slf4j;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestTemplate;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * Fetches cycle pricing from PaymentManagementService GET /api/pricing (no auth required).
 * Results are cached in-process for 60 seconds; on any failure the config defaults are used
 * so the bot keeps working while PMS is unavailable.
 */
@Slf4j
public class PricingClient {

    private static final long TTL_SECONDS = 60;

    private final RestTemplate restTemplate;
    private final String pricingUrl;
    private final int shortCycleFallback;
    private final int longCycleFallback;

    private volatile List<Map<String, Object>> cached = null;
    private volatile Instant cacheTime = Instant.MIN;

    public PricingClient(RestTemplate restTemplate, String pmsBaseUrl,
                         int shortCycleFallback, int longCycleFallback) {
        this.restTemplate       = restTemplate;
        this.pricingUrl         = pmsBaseUrl + "/api/pricing";
        this.shortCycleFallback = shortCycleFallback;
        this.longCycleFallback  = longCycleFallback;
    }

    public int getShortCyclePrice() {
        return getAmount("short_cycle", shortCycleFallback);
    }

    public int getLongCyclePrice() {
        return getAmount("long_cycle", longCycleFallback);
    }

    public int getDryShortPrice() {
        return getAmount("dry_short", shortCycleFallback);
    }

    public int getDryLongPrice() {
        return getAmount("dry_long", longCycleFallback);
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
        if (restTemplate == null) return null;
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
            log.warn("PricingClient: could not reach {} — using config fallback: {}", pricingUrl, e.getMessage());
        }
        return null;
    }
}
