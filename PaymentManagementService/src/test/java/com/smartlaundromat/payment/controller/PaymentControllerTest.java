package com.smartlaundromat.payment.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.smartlaundromat.payment.dto.PaymentResponse;
import com.smartlaundromat.payment.exception.GlobalExceptionHandler;
import com.smartlaundromat.payment.exception.PaymentException;
import com.smartlaundromat.payment.model.Transaction;
import com.smartlaundromat.payment.model.enums.PaymentProvider;
import com.smartlaundromat.payment.model.enums.PaymentStatus;
import com.smartlaundromat.payment.service.PaymentService;
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
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(PaymentController.class)
@Import({PaymentControllerTest.TestSecurityConfig.class, GlobalExceptionHandler.class})
class PaymentControllerTest {

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
    PaymentService paymentService;

    @Test
    void shouldInitiatePayment() throws Exception {
        // given
        PaymentResponse response = PaymentResponse.builder()
                .success(true)
                .externalReference("EXT-001")
                .providerReference("PROV-001")
                .provider(PaymentProvider.CAMPAY)
                .status(PaymentStatus.PENDING)
                .amount(new BigDecimal("1000"))
                .message("Payment initiated")
                .build();
        when(paymentService.initiatePayment(any())).thenReturn(response);

        String body = """
                {
                    "phoneNumber": "237612345678",
                    "amount": 1000,
                    "machineId": "MACH-01",
                    "pulseCount": 2,
                    "cycleDuration": 30,
                    "provider": "CAMPAY",
                    "description": "Wash"
                }
                """;

        // when / then
        mockMvc.perform(post("/api/payments/initiate")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.externalReference").value("EXT-001"));
    }

    @Test
    void shouldReturn400WhenMachineBusy() throws Exception {
        // given
        when(paymentService.initiatePayment(any()))
                .thenThrow(new PaymentException("MACHINE_BUSY", "Machine has an active cycle"));

        String body = """
                {
                    "phoneNumber": "237612345678",
                    "amount": 1000,
                    "machineId": "MACH-01",
                    "pulseCount": 2,
                    "cycleDuration": 30,
                    "provider": "CAMPAY"
                }
                """;

        // when / then
        mockMvc.perform(post("/api/payments/initiate")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("MACHINE_BUSY"));
    }

    @Test
    void shouldReturn400WhenValidationFails() throws Exception {
        // given — missing required fields
        String body = """
                {"description": "only description"}
                """;

        // when / then
        mockMvc.perform(post("/api/payments/initiate")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest());
    }

    @Test
    void shouldGetTransactionByReference() throws Exception {
        // given
        Transaction tx = Transaction.builder()
                .externalReference("EXT-001")
                .machineId("MACH-01")
                .amount(new BigDecimal("1000"))
                .status(PaymentStatus.SUCCESSFUL)
                .paymentProvider(PaymentProvider.CAMPAY)
                .build();
        when(paymentService.getTransactionByReference("EXT-001")).thenReturn(tx);

        // when / then
        mockMvc.perform(get("/api/payments/transaction/EXT-001"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.externalReference").value("EXT-001"));
    }

    @Test
    void shouldReturn400WhenTransactionNotFound() throws Exception {
        // given
        when(paymentService.getTransactionByReference("INVALID"))
                .thenThrow(new PaymentException("TRANSACTION_NOT_FOUND", "Transaction not found"));

        // when / then
        mockMvc.perform(get("/api/payments/transaction/INVALID"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("TRANSACTION_NOT_FOUND"));
    }

    @Test
    void shouldGetTransactionsByMachine() throws Exception {
        // given
        Transaction tx = Transaction.builder().machineId("MACH-01").amount(new BigDecimal("1000"))
                .paymentProvider(PaymentProvider.CAMPAY).build();
        when(paymentService.getTransactionsByMachine("MACH-01")).thenReturn(List.of(tx));

        // when / then
        mockMvc.perform(get("/api/payments/machine/MACH-01"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].machineId").value("MACH-01"));
    }

    @Test
    void shouldGetTransactionsByCard() throws Exception {
        // given
        Transaction tx = Transaction.builder().rfidCardUid("ABC123").amount(new BigDecimal("500"))
                .paymentProvider(PaymentProvider.CAMPAY).build();
        when(paymentService.getTransactionsByCard("ABC123")).thenReturn(List.of(tx));

        // when / then
        mockMvc.perform(get("/api/payments/card/ABC123"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].rfidCardUid").value("ABC123"));
    }

    @Test
    void shouldGetProviderStatus() throws Exception {
        // given
        when(paymentService.getProviderStatus()).thenReturn(Map.of(
                "campay", Map.of("configured", true),
                "mtn", Map.of("configured", false),
                "orange_money", Map.of("configured", true)
        ));

        // when / then
        mockMvc.perform(get("/api/payments/providers/status"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.campay.configured").value(true));
    }
}
