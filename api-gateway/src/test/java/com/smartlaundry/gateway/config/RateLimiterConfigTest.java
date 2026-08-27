package com.smartlaundry.gateway.config;

import org.junit.jupiter.api.Test;
import org.springframework.cloud.gateway.filter.ratelimit.KeyResolver;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.core.context.ReactiveSecurityContextHolder;
import org.springframework.security.core.context.SecurityContextImpl;
import org.springframework.security.oauth2.jwt.Jwt;
import reactor.core.publisher.Mono;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

class RateLimiterConfigTest {

    private final KeyResolver keyResolver = new RateLimiterConfig().tenantAwareKeyResolver();

    @Test
    void shouldKeyM2mTrafficByAuthorizedPartyClaim() {
        // given
        Jwt jwt = jwtWithClaims("client-credentials", "payment-service-m2m", null);
        MockServerWebExchange exchange = MockServerWebExchange.from(MockServerHttpRequest.get("/payments/api/foo"));

        // when
        String key = resolveWithJwt(exchange, jwt);

        // then
        assertThat(key).isEqualTo("client:payment-service-m2m");
    }

    @Test
    void shouldKeyEndUserTrafficBySubjectClaim() {
        // given — no "gty" claim: an authorization-code (dashboard user) token, not M2M
        Jwt jwt = jwtWithClaims(null, null, "auth0|dashboard-user");
        MockServerWebExchange exchange = MockServerWebExchange.from(MockServerHttpRequest.get("/reports/api/summary"));

        // when
        String key = resolveWithJwt(exchange, jwt);

        // then
        assertThat(key).isEqualTo("user:auth0|dashboard-user");
    }

    @Test
    void shouldKeyBotKeyScopedWhatsappWebhookByTenant() {
        // given — unauthenticated: Meta's webhook call, no JWT
        MockServerWebExchange exchange = MockServerWebExchange.from(
                MockServerHttpRequest.post("/bot/api/whatsapp/webhooks/pharmacy"));

        // when
        String key = keyResolver.resolve(exchange).block();

        // then — this is the whole point of R11: two different tenants on the same
        // route must land in two different buckets, not share Meta's shared source IP
        assertThat(key).isEqualTo("bot:pharmacy");
    }

    @Test
    void shouldKeyBotScopedPaymentWebhookByTenant() {
        // given
        MockServerWebExchange exchange = MockServerWebExchange.from(
                MockServerHttpRequest.post("/bot/api/payments/webhooks/campay/laundry"));

        // when
        String key = keyResolver.resolve(exchange).block();

        // then
        assertThat(key).isEqualTo("bot:laundry");
    }

    @Test
    void shouldFallBackToClientIpForTheLegacyRootWhatsappWebhookPath() {
        // given — no botKey segment in the path, a known/disclosed gap
        MockServerWebExchange exchange = MockServerWebExchange.from(
                MockServerHttpRequest.post("/bot/api/whatsapp/webhook").header("X-Forwarded-For", "203.0.113.7"));

        // when
        String key = keyResolver.resolve(exchange).block();

        // then
        assertThat(key).isEqualTo("ip:203.0.113.7");
    }

    private String resolveWithJwt(MockServerWebExchange exchange, Jwt jwt) {
        return keyResolver.resolve(exchange)
                .contextWrite(ReactiveSecurityContextHolder.withSecurityContext(
                        Mono.just(new SecurityContextImpl(new TestingAuthenticationToken(jwt, null)))))
                .block();
    }

    private Jwt jwtWithClaims(String grantType, String authorizedParty, String subject) {
        Instant now = Instant.now();
        Jwt.Builder builder = Jwt.withTokenValue("test-token")
                .header("alg", "RS256")
                .subject(subject != null ? subject : "auth0|placeholder")
                .issuedAt(now)
                .expiresAt(now.plusSeconds(60));
        if (grantType != null) {
            builder.claim("gty", grantType);
        }
        if (authorizedParty != null) {
            builder.claim("azp", authorizedParty);
        }

        return builder.build();
    }
}
