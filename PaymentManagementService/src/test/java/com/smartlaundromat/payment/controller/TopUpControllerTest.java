package com.smartlaundromat.payment.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.smartlaundromat.payment.dto.TopUpResponse;
import com.smartlaundromat.payment.exception.GlobalExceptionHandler;
import com.smartlaundromat.payment.model.TopUpTransaction;
import com.smartlaundromat.payment.model.enums.PaymentStatus;
import com.smartlaundromat.payment.model.enums.TopUpChannel;
import com.smartlaundromat.payment.service.TopUpService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.math.BigDecimal;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(TopUpController.class)
@Import({TopUpControllerTest.TestSecurityConfig.class, GlobalExceptionHandler.class})
class TopUpControllerTest {

    @TestConfiguration
    static class TestSecurityConfig {
        @Bean
        SecurityFilterChain testFilterChain(HttpSecurity http) throws Exception {
            http.csrf(AbstractHttpConfigurer::disable)
                .authorizeHttpRequests(auth -> auth.anyRequest().permitAll());
            return http.build();
        }
    }

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper objectMapper;

    @MockitoBean
    TopUpService topUpService;

    @Test
    void shouldInitiateCashTopUp() throws Exception {
        // given
        TopUpResponse response = TopUpResponse.builder()
                .reference("REF-001")
                .cardUid("ABC123")
                .amount(new BigDecimal("2000"))
                .currency("XAF")
                .channel(TopUpChannel.CASH)
                .status(PaymentStatus.SUCCESSFUL)
                .newBalance(new BigDecimal("7000"))
                .message("Top-up successful")
                .build();
        when(topUpService.initiateTopUp(any())).thenReturn(response);

        String body = """
                {
                    "cardUid": "ABC123",
                    "amount": 2000,
                    "channel": "CASH"
                }
                """;

        // when / then
        mockMvc.perform(post("/api/topup")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("SUCCESSFUL"))
                .andExpect(jsonPath("$.newBalance").value(7000));
    }

    @Test
    void shouldReturn400WhenValidationFails() throws Exception {
        // given — missing required fields
        String body = """
                {"phoneNumber": "237612345678"}
                """;

        // when / then
        mockMvc.perform(post("/api/topup")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest());
    }

    @Test
    void shouldGetTopUpHistory() throws Exception {
        // given
        TopUpTransaction tx = TopUpTransaction.builder()
                .rfidCardUid("ABC123")
                .amount(new BigDecimal("2000"))
                .channel(TopUpChannel.CASH)
                .status(PaymentStatus.SUCCESSFUL)
                .build();
        when(topUpService.getTopUpHistory("ABC123")).thenReturn(List.of(tx));

        // when / then
        mockMvc.perform(get("/api/topup/history/ABC123"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].rfidCardUid").value("ABC123"));
    }
}
