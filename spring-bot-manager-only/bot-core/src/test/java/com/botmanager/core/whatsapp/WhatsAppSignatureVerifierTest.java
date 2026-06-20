package com.botmanager.core.whatsapp;

import com.botmanager.config.WhatsAppProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;

class WhatsAppSignatureVerifierTest {

    private WhatsAppProperties whatsAppProperties;

    private WhatsAppSignatureVerifier verifier;

    @BeforeEach
    void setUp() {
        whatsAppProperties = new WhatsAppProperties();
        whatsAppProperties.setVerifySignature(true);
        whatsAppProperties.setAppSecret("test-secret");
        verifier = new WhatsAppSignatureVerifier(whatsAppProperties);
    }

    @Test
    void shouldReturnTrueWhenSignatureVerificationDisabled() {
        // given
        whatsAppProperties.setVerifySignature(false);

        // when
        boolean result = verifier.verify("any", "any", "any");

        // then
        assertThat(result).isTrue();
    }

    @Test
    void shouldReturnFalseWhenAppSecretIsNull() {
        // when
        boolean result = verifier.verify("sha256=abc", "body", null);

        // then
        assertThat(result).isFalse();
    }

    @Test
    void shouldReturnFalseWhenAppSecretIsEmpty() {
        // when
        boolean result = verifier.verify("sha256=abc", "body", "");

        // then
        assertThat(result).isFalse();
    }

    @Test
    void shouldReturnFalseWhenSignatureIsNull() {
        // when
        boolean result = verifier.verify(null, "body", "secret");

        // then
        assertThat(result).isFalse();
    }

    @Test
    void shouldReturnFalseWhenSignatureIsEmpty() {
        // when
        boolean result = verifier.verify("", "body", "secret");

        // then
        assertThat(result).isFalse();
    }

    @Test
    void shouldVerifyValidSignatureWithPrefix() throws Exception {
        // given
        String body = "{\"test\":\"payload\"}";
        String secret = "my-secret";
        String expectedSignature = computeHmac(body, secret);

        // when
        boolean result = verifier.verify("sha256=" + expectedSignature, body, secret);

        // then
        assertThat(result).isTrue();
    }

    @Test
    void shouldVerifyValidSignatureWithoutPrefix() throws Exception {
        // given
        String body = "{\"test\":\"payload\"}";
        String secret = "my-secret";
        String expectedSignature = computeHmac(body, secret);

        // when
        boolean result = verifier.verify(expectedSignature, body, secret);

        // then
        assertThat(result).isTrue();
    }

    @Test
    void shouldRejectInvalidSignature() {
        // given
        String body = "{\"test\":\"payload\"}";

        // when
        boolean result = verifier.verify("sha256=invalidsignature", body, "my-secret");

        // then
        assertThat(result).isFalse();
    }

    @Test
    void shouldUseDefaultAppSecretFromProperties() throws Exception {
        // given
        String body = "{\"test\":\"payload\"}";
        String secret = "test-secret";
        String expectedSignature = computeHmac(body, secret);

        // when
        boolean result = verifier.verify("sha256=" + expectedSignature, body);

        // then
        assertThat(result).isTrue();
    }

    private String computeHmac(String data, String secret) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        SecretKeySpec keySpec = new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
        mac.init(keySpec);
        byte[] hash = mac.doFinal(data.getBytes(StandardCharsets.UTF_8));
        StringBuilder hex = new StringBuilder();
        for (byte b : hash) {
            String h = Integer.toHexString(0xff & b);
            if (h.length() == 1) hex.append('0');
            hex.append(h);
        }
        return hex.toString();
    }

}
