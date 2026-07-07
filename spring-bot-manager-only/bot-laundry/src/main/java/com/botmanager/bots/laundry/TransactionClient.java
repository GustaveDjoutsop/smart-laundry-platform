package com.botmanager.bots.laundry;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;

/**
 * Queries active cycle status from PaymentManagementService.
 * GET /api/payments/phone/{phone}/active is a public endpoint — no auth required.
 * Returns an empty list on any error so the bot falls back to "no active cycle".
 */
@Slf4j
public class TransactionClient {

    private final RestTemplate restTemplate;
    private final String activeCycleUrl;

    public TransactionClient(RestTemplate restTemplate, String pmsBaseUrl) {
        this.restTemplate = restTemplate;
        this.activeCycleUrl = pmsBaseUrl + "/api/payments/phone/{phone}/active";
    }

    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> getActiveCycles(String phone) {
        if (restTemplate == null || phone == null) return List.of();
        try {
            ResponseEntity<Map> resp = restTemplate.getForEntity(
                    activeCycleUrl, Map.class, Map.of("phone", phone));
            if (resp.getStatusCode().is2xxSuccessful() && resp.getBody() != null) {
                Object cycles = resp.getBody().get("cycles");
                if (cycles instanceof List<?> list) {
                    return (List<Map<String, Object>>) list;
                }
            }
        } catch (Exception e) {
            log.warn("TransactionClient: could not reach PMS for phone={}: {}", phone, e.getMessage());
        }
        return List.of();
    }
}
