package com.smartlaundromat.payment.security;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.Date;

import static org.assertj.core.api.Assertions.assertThat;

class WebhookSignatureVerifierTest {

    // HS256 requires minimum 256-bit (32-byte) key
    private static final String WEBHOOK_KEY = "test-campay-webhook-key-32-bytes!!";
    private static final String WRONG_KEY   = "wrong-campay-webhook-key-32-bytes!!";

    private WebhookSignatureVerifier verifier;

    @BeforeEach
    void setUp() {
        verifier = new WebhookSignatureVerifier();
    }

    // ── verifyJwt ─────────────────────────────────────────────────────────────

    @Nested
    class VerifyJwt {

        private String buildJwt(String signingKey) throws Exception {
            SignedJWT jwt = new SignedJWT(
                    new JWSHeader(JWSAlgorithm.HS256),
                    new JWTClaimsSet.Builder()
                            .issueTime(new Date())
                            .build()
            );
            jwt.sign(new MACSigner(signingKey.getBytes(StandardCharsets.UTF_8)));
            return jwt.serialize();
        }

        @Test
        void shouldReturnTrueForValidJwt() throws Exception {
            String jwt = buildJwt(WEBHOOK_KEY);
            assertThat(verifier.verifyJwt(WEBHOOK_KEY, jwt)).isTrue();
        }

        @Test
        void shouldReturnFalseForJwtSignedWithWrongKey() throws Exception {
            String jwt = buildJwt(WRONG_KEY);
            assertThat(verifier.verifyJwt(WEBHOOK_KEY, jwt)).isFalse();
        }

        @Test
        void shouldReturnFalseForMalformedToken() {
            assertThat(verifier.verifyJwt(WEBHOOK_KEY, "not.a.jwt")).isFalse();
        }

        @Test
        void shouldReturnFalseWhenJwtTokenIsNull() {
            assertThat(verifier.verifyJwt(WEBHOOK_KEY, null)).isFalse();
        }

        @Test
        void shouldReturnFalseWhenWebhookKeyIsNull() throws Exception {
            String jwt = buildJwt(WEBHOOK_KEY);
            assertThat(verifier.verifyJwt(null, jwt)).isFalse();
        }

        @Test
        void shouldReturnFalseWhenBothInputsAreNull() {
            assertThat(verifier.verifyJwt(null, null)).isFalse();
        }
    }

    // ── verifyHmacSha256 (existing method, kept for backward compat) ──────────

    @Nested
    class VerifyHmacSha256 {

        private static final String SECRET = "hmac-test-secret";

        @Test
        void shouldReturnTrueForValidHmac() throws Exception {
            // Compute expected hex manually
            javax.crypto.Mac mac = javax.crypto.Mac.getInstance("HmacSHA256");
            mac.init(new javax.crypto.spec.SecretKeySpec(SECRET.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] bytes = mac.doFinal("hello-world".getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (byte b : bytes) {
                hex.append(String.format("%02x", b));
            }
            assertThat(verifier.verifyHmacSha256(SECRET, "hello-world", hex.toString())).isTrue();
        }

        @Test
        void shouldReturnFalseForWrongSignature() {
            assertThat(verifier.verifyHmacSha256(SECRET, "hello-world", "deadbeef")).isFalse();
        }

        @Test
        void shouldReturnFalseWhenSignatureIsNull() {
            assertThat(verifier.verifyHmacSha256(SECRET, "hello-world", null)).isFalse();
        }

        @Test
        void shouldReturnFalseWhenSecretIsNull() {
            assertThat(verifier.verifyHmacSha256(null, "hello-world", "deadbeef")).isFalse();
        }

        @Test
        void shouldReturnFalseWhenBodyIsNull() {
            assertThat(verifier.verifyHmacSha256(SECRET, null, "deadbeef")).isFalse();
        }
    }
}
