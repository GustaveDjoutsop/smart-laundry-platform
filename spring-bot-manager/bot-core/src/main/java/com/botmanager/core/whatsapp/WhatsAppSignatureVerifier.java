package com.botmanager.core.whatsapp;

import com.botmanager.config.WhatsAppProperties;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

@Slf4j
@Component
@RequiredArgsConstructor
public class WhatsAppSignatureVerifier {

    private static final String SIGNATURE_PREFIX = "sha256=";

    private final WhatsAppProperties whatsAppProperties;

    public boolean verify(String signature, String rawBody) {
        return verify(signature, rawBody, whatsAppProperties.getAppSecret());
    }

    public boolean verify(String signature, String rawBody, String appSecret) {
        if (!whatsAppProperties.isVerifySignature()) {
            return true;
        }

        if (!StringUtils.hasText(appSecret)) {
            log.warn("WhatsApp signature verification enabled but no app secret configured");

            return false;
        }

        if (!StringUtils.hasText(signature)) {
            log.warn("Missing WhatsApp signature header");

            return false;
        }

        String expectedSignature = signature;
        if (signature.startsWith(SIGNATURE_PREFIX)) {
            expectedSignature = signature.substring(SIGNATURE_PREFIX.length());
        }

        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            SecretKeySpec secretKeySpec = new SecretKeySpec(
                    appSecret.getBytes(StandardCharsets.UTF_8),
                    "HmacSHA256"
            );
            mac.init(secretKeySpec);

            byte[] computedBytes = mac.doFinal(rawBody.getBytes(StandardCharsets.UTF_8));
            String computedSignature = bytesToHex(computedBytes);

            return MessageDigest.isEqual(
                    computedSignature.getBytes(StandardCharsets.UTF_8),
                    expectedSignature.getBytes(StandardCharsets.UTF_8)
            );
        } catch (Exception exception) {
            log.error("WhatsApp signature verification failed: {}", exception.getMessage());

            return false;
        }
    }

    private String bytesToHex(byte[] bytes) {
        StringBuilder hexString = new StringBuilder();

        for (byte b : bytes) {
            String hex = Integer.toHexString(0xff & b);

            if (hex.length() == 1) {
                hexString.append('0');
            }

            hexString.append(hex);
        }

        return hexString.toString();
    }

}
