package com.botmanager.admin;

import com.botmanager.auth.AuthDtos;
import com.botmanager.core.persistence.repository.BusinessRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.ActiveProfiles;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class AdminBotControllerTest {

    @Autowired
    private TestRestTemplate restTemplate;

    @Autowired
    private BusinessRepository businessRepository;

    @BeforeEach
    void cleanup() {
        businessRepository.deleteAll();
    }

    @SuppressWarnings("unchecked")
    private String getAdminToken() {
        AuthDtos.LoginRequest loginRequest = new AuthDtos.LoginRequest();
        loginRequest.setUsername("testadmin");
        loginRequest.setPassword("testpass");
        var response = restTemplate.postForEntity("/auth/login", loginRequest, Map.class);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isNotNull();
        return (String) response.getBody().get("token");
    }

    @Test
    void createBotShouldPersistAndReturnCreated() {
        String token = getAdminToken();

        AdminDtos.BotConfigRequest request = AdminDtos.BotConfigRequest.builder()
                .botId("test-laundry")
                .botName("Test Laundry")
                .botType("laundry")
                .phoneNumberId("123456789")
                .verifyToken("test-verify")
                .accessToken("test-access")
                .config(Map.of("defaultFlowId", "laundry_flow", "flows", Map.of()))
                .build();

        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(token);
        var response = restTemplate.exchange("/admin/bots", HttpMethod.POST,
                new HttpEntity<>(request, headers), AdminDtos.BotConfigResponse.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().getBotId()).isEqualTo("test-laundry");
        assertThat(response.getBody().isHasAccessToken()).isTrue();
        assertThat(response.getBody().getConfig()).doesNotContainKeys("verifyToken", "accessToken", "appSecret");
    }

    @Test
    void listBotsWithoutAuthShouldReturn403() {
        var response = restTemplate.getForEntity("/admin/bots", String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    void webhookWithoutAuthShouldBePermitted() {
        var response = restTemplate.getForEntity(
                "/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=test&hub.challenge=challenge123",
                String.class
        );

        assertThat(response.getStatusCode()).isNotEqualTo(HttpStatus.UNAUTHORIZED);
    }
}