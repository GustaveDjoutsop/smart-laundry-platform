package com.botmanager.integration;

import com.botmanager.auth.AuthDtos;
import com.botmanager.core.persistence.repository.BusinessRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class AdminBotControllerIT extends BaseIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private BusinessRepository businessRepository;

    @Autowired
    private ObjectMapper objectMapper;

    @BeforeEach
    void cleanup() {
        businessRepository.deleteAll();
    }

    private String getAdminToken() throws Exception {
        String loginPayload = "{\"username\":\"testadmin\",\"password\":\"testpass\"}";
        var result = mockMvc.perform(post("/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(loginPayload))
                .andExpect(status().isOk())
                .andReturn();
        AuthDtos.TokenResponse tokenResponse = objectMapper.readValue(
                result.getResponse().getContentAsString(), AuthDtos.TokenResponse.class);
        return tokenResponse.getToken();
    }

    @Test
    void adminEndpointsRequireAuthentication() throws Exception {
        mockMvc.perform(get("/admin/bots"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void createBotPersistsConfiguration() throws Exception {
        String token = getAdminToken();

        String payload = """
                {
                  "botId": "test-laundry",
                  "botName": "Test Laundry",
                  "botType": "laundry",
                  "phoneNumberId": "123456789",
                  "verifyToken": "verify-token",
                  "accessToken": "access-token",
                  "config": {
                    "defaultFlowId": "laundry_flow",
                    "flows": {}
                  }
                }
                """;

        mockMvc.perform(post("/admin/bots")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(payload))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.botId").value("test-laundry"))
                .andExpect(jsonPath("$.hasAccessToken").value(true))
                .andExpect(jsonPath("$.enabled").value(true));
    }
}