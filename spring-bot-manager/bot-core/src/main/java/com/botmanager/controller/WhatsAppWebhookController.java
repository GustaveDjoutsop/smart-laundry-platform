package com.botmanager.controller;

import com.botmanager.core.bot.BotLookup;
import com.botmanager.config.WhatsAppProperties;
import com.botmanager.core.whatsapp.WhatsAppSignatureVerifier;
import com.botmanager.handler.WhatsAppWebhookHandler;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.env.Environment;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.Optional;

@Slf4j
@RestController
@RequiredArgsConstructor
public class WhatsAppWebhookController {

    private final BotLookup botLookup;

    private final WhatsAppSignatureVerifier signatureVerifier;

    private final WhatsAppProperties whatsAppProperties;

    private final Environment environment;

    private final WhatsAppWebhookHandler webhookHandler;

    private final ObjectMapper objectMapper;

    @GetMapping({
            "/api/whatsapp/webhook",
            "/api/whatsapp/webhooks"
    })
    public ResponseEntity<String> verifyRoot(@RequestParam("hub.mode") String mode,
                                             @RequestParam("hub.verify_token") String verifyToken,
                                             @RequestParam("hub.challenge") String challenge) {

        return verifyInternal(mode, verifyToken, challenge, null);
    }

    @GetMapping("/api/whatsapp/webhooks/{botKey}")
    public ResponseEntity<String> verifyBot(@RequestParam("hub.mode") String mode,
                                            @RequestParam("hub.verify_token") String verifyToken,
                                            @RequestParam("hub.challenge") String challenge,
                                            @PathVariable("botKey") String botKey) {

        return verifyInternal(mode, verifyToken, challenge, botKey);
    }

    private ResponseEntity<String> verifyInternal(String mode,
                                                  String verifyToken,
                                                  String challenge,
                                                  String botKey) {

        log.info("WhatsApp webhook verification request: mode={}, token={}, pathBot={}", mode, verifyToken, botKey);

        if (!"subscribe".equals(mode)) {
            log.warn("Invalid hub.mode: {}", mode);

            return ResponseEntity.badRequest().body("Invalid mode");
        }

        if (botLookup.getBotNameByVerifyToken(verifyToken).isEmpty()) {
            log.warn("Invalid verify token");

            return ResponseEntity.status(403).body("Invalid token");
        }

        log.info("WhatsApp webhook verified successfully");

        return ResponseEntity.ok(challenge);
    }

    @PostMapping({
            "/api/whatsapp/webhook",
            "/api/whatsapp/webhooks"
    })
    public ResponseEntity<String> handleWebhookRoot(
            @RequestBody String rawBody,
            @RequestHeader(value = "X-Hub-Signature-256", required = false) String signature) {

        return handleWebhookInternal(rawBody, signature, null);
    }

    @PostMapping("/api/whatsapp/webhooks/{botKey}")
    public ResponseEntity<String> handleWebhookBot(
            @RequestBody String rawBody,
            @RequestHeader(value = "X-Hub-Signature-256", required = false) String signature,
            @PathVariable("botKey") String botKey) {

        return handleWebhookInternal(rawBody, signature, botKey);
    }

    private ResponseEntity<String> handleWebhookInternal(
            String rawBody,
            String signature,
            String botKey) {

        log.info(
                "WhatsApp webhook event received: pathBot={}, signaturePresent={}, bytes={}, verifySignature={}",
                botKey,
                signature != null && !signature.isBlank(),
                rawBody != null ? rawBody.length() : 0,
                whatsAppProperties.isVerifySignature()
        );

        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> payload = objectMapper.readValue(rawBody, Map.class);

            String phoneNumberId = extractPhoneNumberId(payload).orElse(null);
            if (phoneNumberId == null) {
                log.warn("WhatsApp webhook payload missing metadata.phone_number_id (pathBot={})", botKey);
            } else {
                log.info("WhatsApp webhook routed by phone_number_id={} (pathBot={})", phoneNumberId, botKey);
            }
            String appSecret = resolveAppSecret(phoneNumberId);

            if (!signatureVerifier.verify(signature, rawBody, appSecret)) {
                log.warn("Invalid webhook signature");

                return ResponseEntity.status(401).body("Invalid signature");
            }

            webhookHandler.handleWebhook(payload);

            return ResponseEntity.ok("EVENT_RECEIVED");
        } catch (Exception exception) {
            log.error("Failed to process webhook: {}", exception.getMessage());

            return ResponseEntity.status(500).body("Processing error");
        }
    }

    @SuppressWarnings("unchecked")
    private Optional<String> extractPhoneNumberId(Map<String, Object> payload) {
        Object entryObj = payload.get("entry");
        if (!(entryObj instanceof Iterable<?> entries)) {
            return Optional.empty();
        }

        for (Object entryItem : entries) {
            if (!(entryItem instanceof Map<?, ?> entry)) {
                continue;
            }

            Object changesObj = entry.get("changes");
            if (!(changesObj instanceof Iterable<?> changes)) {
                continue;
            }

            for (Object changeItem : changes) {
                if (!(changeItem instanceof Map<?, ?> change)) {
                    continue;
                }

                Object valueObj = change.get("value");
                if (!(valueObj instanceof Map<?, ?> value)) {
                    continue;
                }

                Object metadataObj = value.get("metadata");
                if (!(metadataObj instanceof Map<?, ?> metadata)) {
                    continue;
                }

                Object phoneId = metadata.get("phone_number_id");
                if (phoneId instanceof String s && !s.isBlank()) {
                    return Optional.of(s);
                }
            }
        }

        return Optional.empty();
    }

    private String resolveAppSecret(String phoneNumberId) {
        if (phoneNumberId != null) {
            return botLookup.getBotByPhoneId(phoneNumberId)
                    .map(bot -> {
                        String botId = bot.getConfig() != null ? bot.getConfig().getBotId() : null;
                        if (botId == null || botId.isBlank()) {
                            return null;
                        }

                        String envKey = "WHATSAPP_APP_SECRET_" + botId.toUpperCase().replace("-", "_");

                        String secret = environment.getProperty(envKey);
                        if (secret == null || secret.isBlank()) {
                            secret = environment.getProperty("whatsapp.app-secret." + botId);
                        }

                        return secret;
                    })
                    .filter(secret -> secret != null && !secret.isBlank())
                    .orElse(whatsAppProperties.getAppSecret());
        }

        return whatsAppProperties.getAppSecret();
    }

}
