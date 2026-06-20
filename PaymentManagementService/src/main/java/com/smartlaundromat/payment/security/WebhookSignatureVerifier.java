package com.smartlaundromat.payment.security;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * Verifies HMAC-SHA256 webhook signatures (hex-encoded) over the raw request body.
 * Ported from {@code com.botmanager.core.payment.WebhookSignatureVerifier} to keep
 * the algorithm consistent across services.
 */
@Slf4j
@Component
public class WebhookSignatureVerifier {

    public boolean verifyHmacSha256(String secret, String rawBody, String signatureHex) {
        if (secret == null || rawBody == null || signatureHex == null) {
            return false;
        }

        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            SecretKeySpec secretKeySpec = new SecretKeySpec(
                    secret.getBytes(StandardCharsets.UTF_8),
                    "HmacSHA256"
            );
            mac.init(secretKeySpec);

            byte[] expectedBytes = mac.doFinal(rawBody.getBytes(StandardCharsets.UTF_8));
            String expectedHex = bytesToHex(expectedBytes);

            return MessageDigest.isEqual(
                    expectedHex.getBytes(StandardCharsets.UTF_8),
                    signatureHex.getBytes(StandardCharsets.UTF_8)
            );
        } catch (Exception exception) {
            log.error("Signature verification failed: {}", exception.getMessage());
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
