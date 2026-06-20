package com.smartlaundromat.reporting.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Calls the Auth0 Management API to create/delete users.
 * Requires a Machine-to-Machine application in the Auth0 tenant with:
 *   - Authorized API: Auth0 Management API
 *   - Scopes: create:users, delete:users, update:users
 * Set AUTH0_MGMT_CLIENT_ID and AUTH0_MGMT_CLIENT_SECRET in the environment.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class Auth0ManagementService {

    @Value("${auth0.management.domain}")
    private String domain;

    @Value("${auth0.management.client-id:}")
    private String mgmtClientId;

    @Value("${auth0.management.client-secret:}")
    private String mgmtClientSecret;

    @Value("${auth0.management.connection:Username-Password-Authentication}")
    private String connection;

    private final ObjectMapper objectMapper;

    // Simple in-memory token cache (expires 1 hour before Auth0's 24-hour TTL)
    private String cachedToken;
    private Instant tokenExpiresAt = Instant.EPOCH;

    private final RestClient restClient = RestClient.create();

    private boolean isConfigured() {
        return mgmtClientId != null && !mgmtClientId.isBlank()
            && mgmtClientSecret != null && !mgmtClientSecret.isBlank();
    }

    private String getToken() {
        if (Instant.now().isBefore(tokenExpiresAt) && cachedToken != null) {
            return cachedToken;
        }

        String url = "https://" + domain + "/oauth/token";
        Map<String, String> body = Map.of(
            "grant_type",    "client_credentials",
            "client_id",     mgmtClientId,
            "client_secret", mgmtClientSecret,
            "audience",      "https://" + domain + "/api/v2/"
        );

        try {
            String response = restClient.post()
                .uri(url)
                .contentType(MediaType.APPLICATION_JSON)
                .body(body)
                .retrieve()
                .body(String.class);

            Map<String, Object> parsed = objectMapper.readValue(response, new TypeReference<>() {});
            cachedToken     = (String) parsed.get("access_token");
            int expiresIn   = parsed.containsKey("expires_in") ? ((Number) parsed.get("expires_in")).intValue() : 86400;
            tokenExpiresAt  = Instant.now().plusSeconds(expiresIn - 3600);
            return cachedToken;
        } catch (Exception e) {
            log.error("Failed to get Auth0 Management API token: {}", e.getMessage());
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                "Unable to connect to Auth0 Management API");
        }
    }

    /**
     * Creates a user in Auth0 and returns their Auth0 user_id (sub).
     * Stores the role in app_metadata so the Post Login Action can inject it into JWT claims.
     */
    public String createUser(String email, String name, String password, String role) {
        if (!isConfigured()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                "Auth0 Management API is not configured on this server. "
                + "Set AUTH0_MGMT_CLIENT_ID and AUTH0_MGMT_CLIENT_SECRET.");
        }

        String token = getToken();
        String url   = "https://" + domain + "/api/v2/users";

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("connection",     connection);
        body.put("email",          email);
        body.put("name",           name);
        body.put("password",       password);
        body.put("email_verified", false);
        if (role != null && !role.isBlank()) {
            body.put("app_metadata", Map.of("role", role));
        }

        try {
            String response = restClient.post()
                .uri(url)
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .body(body)
                .retrieve()
                .body(String.class);

            Map<String, Object> parsed = objectMapper.readValue(response, new TypeReference<>() {});
            String userId = (String) parsed.get("user_id");
            log.info("Created Auth0 user: {} → {}", email, userId);
            return userId;

        } catch (HttpClientErrorException e) {
            String responseBody = e.getResponseBodyAsString();
            log.error("Auth0 create user failed for {}: {} — {}", email, e.getStatusCode(), responseBody);
            if (e.getStatusCode().value() == 409) {
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "A user with email " + email + " already exists in Auth0");
            }
            // Parse Auth0 error message if possible
            try {
                Map<String, Object> err = objectMapper.readValue(responseBody, new TypeReference<>() {});
                String msg = (String) err.getOrDefault("message", e.getMessage());
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, msg);
            } catch (ResponseStatusException rse) {
                throw rse;
            } catch (Exception ignored) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage());
            }
        } catch (ResponseStatusException rse) {
            throw rse;
        } catch (Exception e) {
            log.error("Unexpected error creating Auth0 user: {}", e.getMessage());
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                "Failed to create user in Auth0: " + e.getMessage());
        }
    }

    /**
     * Updates a user's password in Auth0.
     * Requires update:users scope on the M2M client.
     */
    public void updatePassword(String auth0UserId, String newPassword) {
        if (!isConfigured()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                "Auth0 Management API is not configured on this server.");
        }
        String token     = getToken();
        String encodedId = auth0UserId.replace("|", "%7C");
        String url       = "https://" + domain + "/api/v2/users/" + encodedId;

        try {
            restClient.patch()
                .uri(url)
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .body(Map.of("password", newPassword, "connection", connection))
                .retrieve()
                .toBodilessEntity();
            log.info("Password updated for Auth0 user: {}", auth0UserId);
        } catch (HttpClientErrorException e) {
            String responseBody = e.getResponseBodyAsString();
            log.error("Auth0 update password failed for {}: {} — {}", auth0UserId, e.getStatusCode(), responseBody);
            try {
                Map<String, Object> err = objectMapper.readValue(responseBody, new TypeReference<>() {});
                String msg = (String) err.getOrDefault("message", e.getMessage());
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, msg);
            } catch (ResponseStatusException rse) {
                throw rse;
            } catch (Exception ignored) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage());
            }
        } catch (ResponseStatusException rse) {
            throw rse;
        } catch (Exception e) {
            log.error("Unexpected error updating Auth0 password: {}", e.getMessage());
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                "Failed to update password: " + e.getMessage());
        }
    }

    /**
     * Deletes a user from Auth0. No-ops if auth0UserId is null/blank.
     */
    public void deleteUser(String auth0UserId) {
        if (!isConfigured() || auth0UserId == null || auth0UserId.isBlank()) return;

        String token = getToken();
        // auth0UserId may contain | which must be URL-encoded as %7C
        String encodedId = auth0UserId.replace("|", "%7C");
        String url = "https://" + domain + "/api/v2/users/" + encodedId;

        try {
            restClient.delete()
                .uri(url)
                .header("Authorization", "Bearer " + token)
                .retrieve()
                .toBodilessEntity();
            log.info("Deleted Auth0 user: {}", auth0UserId);
        } catch (Exception e) {
            // Log but don't throw — the ops.staff record will still be deleted
            log.warn("Failed to delete Auth0 user {}: {}", auth0UserId, e.getMessage());
        }
    }
}
