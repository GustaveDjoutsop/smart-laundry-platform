package com.smartlaundry.gateway.config;

import org.springframework.cloud.gateway.filter.ratelimit.KeyResolver;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.security.core.context.ReactiveSecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import reactor.core.publisher.Mono;

/**
 * Resolves the bucket key for {@code RequestRateLimiter}: the authenticated
 * user's Auth0 {@code sub} claim when present (per-user limiting), falling
 * back to the client IP — via {@code X-Forwarded-For} when present, else the
 * remote address — for unauthenticated requests. Mirrors the IP-detection
 * logic of the bot's existing {@code RateLimitFilter}, which keeps running in
 * parallel until this gateway limiter is proven (see design doc §7).
 */
@Configuration(proxyBeanMethods = false)
public class RateLimiterConfig {

    @Bean
    @Primary
    public KeyResolver userOrIpKeyResolver() {
        return exchange -> ReactiveSecurityContextHolder.getContext()
                .map(context -> context.getAuthentication())
                .filter(auth -> auth != null && auth.getPrincipal() instanceof Jwt)
                .map(auth -> ((Jwt) auth.getPrincipal()).getSubject())
                .switchIfEmpty(Mono.fromSupplier(() -> resolveClientIp(exchange)))
                .defaultIfEmpty("unknown");
    }

    private String resolveClientIp(org.springframework.web.server.ServerWebExchange exchange) {
        String forwardedFor = exchange.getRequest().getHeaders().getFirst("X-Forwarded-For");
        if (forwardedFor != null && !forwardedFor.isBlank()) {
            return forwardedFor.split(",")[0].trim();
        }
        if (exchange.getRequest().getRemoteAddress() != null) {
            return exchange.getRequest().getRemoteAddress().getAddress().getHostAddress();
        }
        return "unknown";
    }
}
