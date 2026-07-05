package com.botmanager.bots.laundry;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestTemplate;

import java.util.Map;

/**
 * Queries active cycle status from PaymentManagementService.
 * GET /api/payments/phone/{phone}/active is a public endpoint — no auth required.
 * Returns null on any error so the bot falls back to "no active cycle".
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
    public Map<String, Object> getActiveCycle(String phone) {
        if (restTemplate == null || phone == null) return null;
        try {
            ResponseEntity<Map> resp = restTemplate.getForEntity(
                    activeCycleUrl, Map.class, Map.of("phone", phone));
            if (resp.getStatusCode().is2xxSuccessful() && resp.getBody() != null) {
                return resp.getBody();
            }
        } catch (Exception e) {
            log.warn("TransactionClient: could not reach PMS for phone={}: {}", phone, e.getMessage());
        }
        return null;
    }
}
