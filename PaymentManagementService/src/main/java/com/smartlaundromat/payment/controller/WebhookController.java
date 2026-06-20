package com.smartlaundromat.payment.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.smartlaundromat.payment.config.PaymentConfig;
import com.smartlaundromat.payment.dto.WebhookPayload;
import com.smartlaundromat.payment.exception.PaymentException;
import com.smartlaundromat.payment.model.enums.PaymentProvider;
import com.smartlaundromat.payment.security.WebhookSignatureVerifier;
import com.smartlaundromat.payment.service.PaymentService;
import com.smartlaundromat.payment.service.TopUpService;
import com.smartlaundromat.payment.service.provider.MtnMomoService;
import com.smartlaundromat.payment.service.provider.OrangeMoneyService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * Receives payment provider callbacks (CamPay, MTN MoMo, Orange Money).
 *
 * <p>All endpoints are <strong>public</strong> (no Bearer token required) and are
 * secured by HMAC signature verification inside each provider's controller logic.
 *
 * <p>Note: EQLink is not listed here because EQLink is a machine CONTROL platform,
 * not a payment system. There are no EQLink payment webhooks.
 */
@RestController
@RequestMapping("/api/webhook")
@Slf4j
@RequiredArgsConstructor
public class WebhookController {

    private final PaymentService paymentService;
    private final TopUpService topUpService;
    private final PaymentConfig paymentConfig;
    private final WebhookSignatureVerifier signatureVerifier;
    private final MtnMomoService mtnMomoService;
    private final OrangeMoneyService orangeMoneyService;
    private final ObjectMapper objectMapper;

    // ── CamPay ────────────────────────────────────────────────────────────────

    @PostMapping("/campay")
    public ResponseEntity<Map<String, String>> handleCampayWebhook(
            @RequestHeader(value = "X-Campay-Signature", required = false) String signature,
            @RequestBody String rawBody) throws Exception {

        String webhookSecret = paymentConfig.getCampay().getWebhookSecret();
        if (!StringUtils.hasText(webhookSecret)) {
            log.error("CamPay webhook rejected: CAMPAY_WEBHOOK_SECRET is not configured");
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(Map.of("status", "error", "message", "Webhook not configured"));
        }

        if (!signatureVerifier.verifyHmacSha256(webhookSecret, rawBody, signature)) {
            log.warn("CamPay webhook rejected: invalid or missing signature");
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("status", "error", "message", "Invalid signature"));
        }

        WebhookPayload payload = objectMapper.readValue(rawBody, WebhookPayload.class);
        log.info("CamPay webhook received: ref={}, status={}", payload.getExternalReference(), payload.getStatus());

        processPaymentWebhookIfApplicable(() -> paymentService.processWebhook(
                PaymentProvider.CAMPAY,
                payload.getExternalReference(),
                payload.getStatus(),
                payload.getReference(),
                payload.getReason()
        ));

        processTopUpWebhookIfApplicable(payload);

        return ResponseEntity.ok(Map.of("status", "received"));
    }

    // ── MTN MoMo ──────────────────────────────────────────────────────────────

    @PostMapping("/mtn")
    public ResponseEntity<Map<String, String>> handleMtnWebhook(@RequestBody WebhookPayload payload) {
        if (!mtnMomoService.isConfigured()) {
            log.warn("MTN webhook rejected: MTN MoMo provider is not configured");
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(Map.of("status", "error", "message", "Provider not configured"));
        }

        // TODO: verify MTN MoMo callback authenticity (provider-specific signature/IPN auth)
        // before this provider goes live — tracked alongside the CamPay HMAC check.
        log.info("MTN webhook received: ref={}, status={}", payload.getExternalReference(), payload.getStatus());

        processPaymentWebhookIfApplicable(() -> paymentService.processWebhook(
                PaymentProvider.MTN,
                payload.getExternalReference(),
                payload.getStatus(),
                payload.getFinancialTransactionId(),
                payload.getReason()
        ));

        processTopUpWebhookIfApplicable(payload);

        return ResponseEntity.ok(Map.of("status", "received"));
    }

    // ── Orange Money ──────────────────────────────────────────────────────────

    @PostMapping("/orange")
    public ResponseEntity<Map<String, String>> handleOrangeWebhook(@RequestBody WebhookPayload payload) {
        if (!orangeMoneyService.isConfigured()) {
            log.warn("Orange Money webhook rejected: Orange Money provider is not configured");
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(Map.of("status", "error", "message", "Provider not configured"));
        }

        // TODO: verify Orange Money callback authenticity (provider-specific signature)
        // before this provider goes live — tracked alongside the CamPay HMAC check.
        log.info("Orange webhook received: ref={}, status={}", payload.getExternalReference(), payload.getStatus());

        processPaymentWebhookIfApplicable(() -> paymentService.processWebhook(
                PaymentProvider.ORANGE_MONEY,
                payload.getExternalReference(),
                payload.getStatus(),
                payload.getReference(),
                payload.getReason()
        ));

        processTopUpWebhookIfApplicable(payload);

        return ResponseEntity.ok(Map.of("status", "received"));
    }

    // ── Shared ────────────────────────────────────────────────────────────────

    /**
     * Some provider webhooks confirm an RFID top-up, not a machine payment — in that
     * case there is no matching {@code Transaction} and {@link PaymentService}
     * throws {@code TRANSACTION_NOT_FOUND}, which is expected and not an error here.
     */
    private void processPaymentWebhookIfApplicable(Runnable action) {
        try {
            action.run();
        } catch (PaymentException ex) {
            if (!"TRANSACTION_NOT_FOUND".equals(ex.getErrorCode())) {
                throw ex;
            }
        }
    }

    /**
     * Most provider webhooks confirm a machine payment, not an RFID top-up — in that
     * case there is no matching {@code TopUpTransaction} and {@link TopUpService}
     * throws {@code TOPUP_NOT_FOUND}, which is expected and not an error here.
     */
    private void processTopUpWebhookIfApplicable(WebhookPayload payload) {
        try {
            topUpService.processTopUpWebhook(payload.getExternalReference(), payload.getStatus(), payload.getReason());
        } catch (PaymentException ex) {
            if (!"TOPUP_NOT_FOUND".equals(ex.getErrorCode())) {
                throw ex;
            }
        }
    }
}
