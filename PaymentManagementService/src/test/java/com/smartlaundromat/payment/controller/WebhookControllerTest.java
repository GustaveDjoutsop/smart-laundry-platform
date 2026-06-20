package com.smartlaundromat.payment.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.smartlaundromat.payment.config.PaymentConfig;
import com.smartlaundromat.payment.exception.GlobalExceptionHandler;
import com.smartlaundromat.payment.model.Transaction;
import com.smartlaundromat.payment.model.enums.PaymentProvider;
import com.smartlaundromat.payment.model.enums.PaymentStatus;
import com.smartlaundromat.payment.security.WebhookSignatureVerifier;
import com.smartlaundromat.payment.service.PaymentService;
import com.smartlaundromat.payment.service.TopUpService;
import com.smartlaundromat.payment.service.provider.MtnMomoService;
import com.smartlaundromat.payment.service.provider.OrangeMoneyService;
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

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(WebhookController.class)
@Import({WebhookControllerTest.TestSecurityConfig.class, GlobalExceptionHandler.class})
class WebhookControllerTest {

    private static final String WEBHOOK_SECRET = "test-webhook-secret";

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

    @MockitoBean
    TopUpService topUpService;

    @MockitoBean
    PaymentConfig paymentConfig;

    @MockitoBean
    WebhookSignatureVerifier signatureVerifier;

    @MockitoBean
    MtnMomoService mtnMomoService;

    @MockitoBean
    OrangeMoneyService orangeMoneyService;

    private void withConfiguredCampaySecret() {
        PaymentConfig.CampayConfig campayConfig = new PaymentConfig.CampayConfig();
        campayConfig.setWebhookSecret(WEBHOOK_SECRET);
        when(paymentConfig.getCampay()).thenReturn(campayConfig);
    }

    @Test
    void shouldHandleCampayWebhook() throws Exception {
        // given
        withConfiguredCampaySecret();
        when(signatureVerifier.verifyHmacSha256(eq(WEBHOOK_SECRET), anyString(), eq("valid-sig"))).thenReturn(true);

        Transaction tx = Transaction.builder()
                .externalReference("EXT-001")
                .status(PaymentStatus.SUCCESSFUL)
                .paymentProvider(PaymentProvider.CAMPAY)
                .build();
        when(paymentService.processWebhook(eq(PaymentProvider.CAMPAY), anyString(), anyString(), anyString(), any()))
                .thenReturn(tx);

        String body = """
                {
                    "externalReference": "EXT-001",
                    "status": "SUCCESSFUL",
                    "reference": "CAMP-REF-001"
                }
                """;

        // when / then
        mockMvc.perform(post("/api/webhook/campay")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("X-Campay-Signature", "valid-sig")
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("received"));

        verify(paymentService).processWebhook(eq(PaymentProvider.CAMPAY), eq("EXT-001"), eq("SUCCESSFUL"), eq("CAMP-REF-001"), isNull());
    }

    @Test
    void shouldRejectCampayWebhookWithInvalidSignature() throws Exception {
        // given
        withConfiguredCampaySecret();
        when(signatureVerifier.verifyHmacSha256(eq(WEBHOOK_SECRET), anyString(), anyString())).thenReturn(false);

        String body = """
                {
                    "externalReference": "EXT-001",
                    "status": "SUCCESSFUL",
                    "reference": "CAMP-REF-001"
                }
                """;

        // when / then
        mockMvc.perform(post("/api/webhook/campay")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("X-Campay-Signature", "forged-sig")
                        .content(body))
                .andExpect(status().isUnauthorized());

        verifyNoInteractions(paymentService);
    }

    @Test
    void shouldRejectCampayWebhookWithMissingSignatureHeader() throws Exception {
        // given
        withConfiguredCampaySecret();
        when(signatureVerifier.verifyHmacSha256(eq(WEBHOOK_SECRET), anyString(), isNull())).thenReturn(false);

        String body = """
                {
                    "externalReference": "EXT-001",
                    "status": "SUCCESSFUL",
                    "reference": "CAMP-REF-001"
                }
                """;

        // when / then
        mockMvc.perform(post("/api/webhook/campay")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isUnauthorized());

        verifyNoInteractions(paymentService);
    }

    @Test
    void shouldRejectCampayWebhookWhenSecretNotConfigured() throws Exception {
        // given
        when(paymentConfig.getCampay()).thenReturn(new PaymentConfig.CampayConfig());

        String body = """
                {
                    "externalReference": "EXT-001",
                    "status": "SUCCESSFUL",
                    "reference": "CAMP-REF-001"
                }
                """;

        // when / then
        mockMvc.perform(post("/api/webhook/campay")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("X-Campay-Signature", "any-sig")
                        .content(body))
                .andExpect(status().isServiceUnavailable());

        verifyNoInteractions(paymentService);
        verifyNoInteractions(signatureVerifier);
    }

    @Test
    void shouldHandleMtnWebhook() throws Exception {
        // given
        when(mtnMomoService.isConfigured()).thenReturn(true);

        Transaction tx = Transaction.builder()
                .externalReference("EXT-002")
                .status(PaymentStatus.SUCCESSFUL)
                .build();
        when(paymentService.processWebhook(eq(PaymentProvider.MTN), anyString(), anyString(), anyString(), any()))
                .thenReturn(tx);

        String body = """
                {
                    "externalReference": "EXT-002",
                    "status": "SUCCESSFUL",
                    "financialTransactionId": "FIN-001"
                }
                """;

        // when / then
        mockMvc.perform(post("/api/webhook/mtn")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("received"));

        verify(paymentService).processWebhook(eq(PaymentProvider.MTN), eq("EXT-002"), eq("SUCCESSFUL"), eq("FIN-001"), isNull());
    }

    @Test
    void shouldRejectMtnWebhookWhenProviderNotConfigured() throws Exception {
        // given
        when(mtnMomoService.isConfigured()).thenReturn(false);

        String body = """
                {
                    "externalReference": "EXT-002",
                    "status": "SUCCESSFUL",
                    "financialTransactionId": "FIN-001"
                }
                """;

        // when / then
        mockMvc.perform(post("/api/webhook/mtn")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isServiceUnavailable());

        verifyNoInteractions(paymentService);
    }

    @Test
    void shouldHandleOrangeWebhook() throws Exception {
        // given
        when(orangeMoneyService.isConfigured()).thenReturn(true);

        Transaction tx = Transaction.builder()
                .externalReference("EXT-003")
                .status(PaymentStatus.SUCCESSFUL)
                .build();
        when(paymentService.processWebhook(eq(PaymentProvider.ORANGE_MONEY), anyString(), anyString(), anyString(), any()))
                .thenReturn(tx);

        String body = """
                {
                    "externalReference": "EXT-003",
                    "status": "SUCCESSFUL",
                    "reference": "ORANGE-REF-001"
                }
                """;

        // when / then
        mockMvc.perform(post("/api/webhook/orange")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("received"));

        verify(paymentService).processWebhook(eq(PaymentProvider.ORANGE_MONEY), eq("EXT-003"), eq("SUCCESSFUL"), eq("ORANGE-REF-001"), isNull());
    }

    @Test
    void shouldRejectOrangeWebhookWhenProviderNotConfigured() throws Exception {
        // given
        when(orangeMoneyService.isConfigured()).thenReturn(false);

        String body = """
                {
                    "externalReference": "EXT-003",
                    "status": "SUCCESSFUL",
                    "reference": "ORANGE-REF-001"
                }
                """;

        // when / then
        mockMvc.perform(post("/api/webhook/orange")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isServiceUnavailable());

        verifyNoInteractions(paymentService);
    }

    @Test
    void shouldHandleFailedWebhook() throws Exception {
        // given
        withConfiguredCampaySecret();
        when(signatureVerifier.verifyHmacSha256(eq(WEBHOOK_SECRET), anyString(), eq("valid-sig"))).thenReturn(true);

        Transaction tx = Transaction.builder()
                .externalReference("EXT-004")
                .status(PaymentStatus.FAILED)
                .build();
        when(paymentService.processWebhook(any(), anyString(), anyString(), any(), anyString()))
                .thenReturn(tx);

        String body = """
                {
                    "externalReference": "EXT-004",
                    "status": "FAILED",
                    "reference": "CAMP-REF-002",
                    "reason": "Insufficient funds"
                }
                """;

        // when / then
        mockMvc.perform(post("/api/webhook/campay")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("X-Campay-Signature", "valid-sig")
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("received"));
    }
}
