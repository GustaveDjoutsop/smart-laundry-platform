package com.smartlaundromat.payment.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.smartlaundromat.payment.dto.RfidBalanceResponse;
import com.smartlaundromat.payment.dto.RfidCardRegistrationRequest;
import com.smartlaundromat.payment.dto.TransactionDebitResponse;
import com.smartlaundromat.payment.exception.CardNotFoundException;
import com.smartlaundromat.payment.exception.GlobalExceptionHandler;
import com.smartlaundromat.payment.exception.InsufficientBalanceException;
import com.smartlaundromat.payment.model.RfidCard;
import com.smartlaundromat.payment.service.RfidCardService;
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
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(RfidCardController.class)
@Import({RfidCardControllerTest.TestSecurityConfig.class, GlobalExceptionHandler.class})
class RfidCardControllerTest {

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
    RfidCardService rfidCardService;

    @Test
    void shouldRegisterCardAndReturn201() throws Exception {
        // given
        RfidCard card = RfidCard.builder().cardUid("NEW001").ownerName("Jane").build();
        when(rfidCardService.registerCard(any(RfidCardRegistrationRequest.class))).thenReturn(card);

        String body = """
                {"cardUid": "NEW001", "ownerName": "Jane", "phoneNumber": "237612345678"}
                """;

        // when / then
        mockMvc.perform(post("/api/rfid/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.cardUid").value("NEW001"));
    }

    @Test
    void shouldReturn400WhenCardUidIsBlank() throws Exception {
        // given
        String body = """
                {"cardUid": "", "ownerName": "Jane"}
                """;

        // when / then
        mockMvc.perform(post("/api/rfid/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest());
    }

    @Test
    void shouldCheckBalance() throws Exception {
        // given
        RfidBalanceResponse response = RfidBalanceResponse.builder()
                .cardUid("ABC123")
                .balance(new BigDecimal("5000"))
                .currency("XAF")
                .sufficient(true)
                .message("OK")
                .build();
        when(rfidCardService.checkBalance(eq("ABC123"), any())).thenReturn(response);

        // when / then
        mockMvc.perform(get("/api/rfid/balance/ABC123"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.cardUid").value("ABC123"))
                .andExpect(jsonPath("$.sufficient").value(true));
    }

    @Test
    void shouldCheckBalanceWithRequiredAmount() throws Exception {
        // given
        RfidBalanceResponse response = RfidBalanceResponse.builder()
                .cardUid("ABC123")
                .balance(new BigDecimal("5000"))
                .sufficient(true)
                .build();
        when(rfidCardService.checkBalance(eq("ABC123"), eq(new BigDecimal("3000")))).thenReturn(response);

        // when / then
        mockMvc.perform(get("/api/rfid/balance/ABC123").param("requiredAmount", "3000"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sufficient").value(true));
    }

    @Test
    void shouldReturn404WhenCardNotFound() throws Exception {
        // given
        when(rfidCardService.checkBalance(eq("INVALID"), any()))
                .thenThrow(new CardNotFoundException("Card not found: INVALID"));

        // when / then
        mockMvc.perform(get("/api/rfid/balance/INVALID"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("CARD_NOT_FOUND"));
    }

    @Test
    void shouldDebitCard() throws Exception {
        // given
        TransactionDebitResponse response = TransactionDebitResponse.builder()
                .success(true)
                .cardUid("ABC123")
                .machineId("MACH-01")
                .amountDebited(new BigDecimal("1000"))
                .remainingBalance(new BigDecimal("4000"))
                .build();
        when(rfidCardService.debitCard(any(), any(), any(), any(), any(), any())).thenReturn(response);

        String body = """
                {
                    "cardUid": "ABC123",
                    "amount": 1000,
                    "machineId": "MACH-01",
                    "pulseCount": 2,
                    "cycleDuration": 30,
                    "description": "Wash"
                }
                """;

        // when / then
        mockMvc.perform(post("/api/rfid/debit")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.remainingBalance").value(4000));
    }

    @Test
    void shouldReturn400WhenDebitInsufficientBalance() throws Exception {
        // given
        when(rfidCardService.debitCard(any(), any(), any(), any(), any(), any()))
                .thenThrow(new InsufficientBalanceException("Insufficient balance"));

        String body = """
                {
                    "cardUid": "ABC123",
                    "amount": 99999,
                    "machineId": "MACH-01",
                    "pulseCount": 1,
                    "cycleDuration": 30
                }
                """;

        // when / then
        mockMvc.perform(post("/api/rfid/debit")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("INSUFFICIENT_BALANCE"));
    }

    @Test
    void shouldGetAllCards() throws Exception {
        // given
        RfidCard card = RfidCard.builder().cardUid("ABC123").build();
        when(rfidCardService.getAllCards()).thenReturn(List.of(card));

        // when / then
        mockMvc.perform(get("/api/rfid/cards"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].cardUid").value("ABC123"));
    }

    @Test
    void shouldGetCardByUid() throws Exception {
        // given
        RfidCard card = RfidCard.builder().cardUid("ABC123").ownerName("John").build();
        when(rfidCardService.getCardByUid("ABC123")).thenReturn(card);

        // when / then
        mockMvc.perform(get("/api/rfid/cards/ABC123"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ownerName").value("John"));
    }

    @Test
    void shouldDeactivateCard() throws Exception {
        // given
        RfidCard card = RfidCard.builder().cardUid("ABC123").isActive(false).build();
        when(rfidCardService.deactivateCard("ABC123")).thenReturn(card);

        // when / then
        mockMvc.perform(patch("/api/rfid/cards/ABC123/deactivate"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.isActive").value(false));
    }

    @Test
    void shouldActivateCard() throws Exception {
        // given
        RfidCard card = RfidCard.builder().cardUid("ABC123").isActive(true).build();
        when(rfidCardService.activateCard("ABC123")).thenReturn(card);

        // when / then
        mockMvc.perform(patch("/api/rfid/cards/ABC123/activate"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.isActive").value(true));
    }
}
