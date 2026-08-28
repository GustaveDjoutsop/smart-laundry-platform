package com.botmanager.middleware;

import com.botmanager.config.RateLimitProperties;
import com.botmanager.core.bot.BaseBot;
import com.botmanager.core.bot.BotConfig;
import com.botmanager.core.bot.BotLookup;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * R11 — every tenant's WhatsApp webhook (and every tenant's payment-provider webhook)
 * arrives from that provider's own shared infrastructure IPs, not the end customer's —
 * so bucketing by {@code path + clientIp} alone (the previous behavior) meant every
 * tenant using a given endpoint category shared *one* bucket: a flood on one tenant's
 * bot could exhaust the budget for every other tenant on the same path. This filter
 * buckets by tenant/bot ID instead, extracted from the request's own path-scoped routes
 * ({@code /api/whatsapp/webhooks/{botKey}}, {@code /api/payments/webhooks/{provider}/
 * {botId}}, {@code /api/payments/{botId}/...}), falling back to client IP only for the
 * legacy, non-tenant-scoped root WhatsApp webhook path (a known, disclosed gap — see the
 * R11 PR description).
 *
 * <p>Each bot may override the global {@link RateLimitProperties} default for its own
 * traffic via {@link BotConfig#getRateLimit()}, read alongside its other config.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class RateLimitFilter extends OncePerRequestFilter {

    private static final Pattern WHATSAPP_TENANT_PATTERN = Pattern.compile("/api/whatsapp/webhooks?/([^/]+)");

    private static final Pattern PAYMENTS_TENANT_PATTERN =
            Pattern.compile("/api/payments/(?:webhooks/[^/]+/([^/]+)|([^/]+)/.*)");

    private final RateLimitProperties rateLimitProperties;

    private final BotLookup botLookup;

    private final Map<String, TokenBucket> buckets = new ConcurrentHashMap<>();

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {

        String path = request.getRequestURI();
        String clientIp = getClientIp(request);

        Category category = categoryFor(path);
        if (category == null) {
            filterChain.doFilter(request, response);

            return;
        }

        String botId = extractBotId(path, category).orElse(null);
        RateLimitProperties.EndpointLimit limit = resolveLimit(category, botId);

        String bucketKey = category + ":" + (botId != null ? botId : ("ip:" + clientIp));
        TokenBucket bucket = buckets.computeIfAbsent(bucketKey,
                k -> new TokenBucket(limit.getMaxRequests(), limit.getWindowMs()));

        if (!bucket.tryConsume()) {
            long retryAfter = bucket.getRetryAfterSeconds();
            response.setStatus(429);
            response.setHeader("Retry-After", String.valueOf(retryAfter));
            response.setContentType("application/json");
            response.getWriter().write("{\"error\":\"Too Many Requests\",\"retryAfter\":" + retryAfter + "}");

            log.warn("Rate limit exceeded for {} (bot={}) from {}", path, botId, clientIp);

            return;
        }

        filterChain.doFilter(request, response);
    }

    private Category categoryFor(String path) {
        if (path.contains("/whatsapp")) {
            return Category.WHATSAPP;
        }

        if (path.contains("/payments")) {
            return Category.PAYMENTS;
        }

        return null;
    }

    private Optional<String> extractBotId(String path, Category category) {
        if (category == Category.WHATSAPP) {
            Matcher matcher = WHATSAPP_TENANT_PATTERN.matcher(path);

            return matcher.find() ? Optional.of(matcher.group(1)) : Optional.empty();
        }

        Matcher matcher = PAYMENTS_TENANT_PATTERN.matcher(path);
        if (!matcher.find()) {
            return Optional.empty();
        }

        return Optional.ofNullable(matcher.group(1) != null ? matcher.group(1) : matcher.group(2));
    }

    private RateLimitProperties.EndpointLimit resolveLimit(Category category, String botId) {
        RateLimitProperties.EndpointLimit override = botId == null ? null : botLookup.getBotByName(botId)
                .map(BaseBot::getConfig)
                .map(BotConfig::getRateLimit)
                .map(rateLimit -> category == Category.WHATSAPP ? rateLimit.getWhatsapp() : rateLimit.getPayments())
                .orElse(null);

        if (override != null) {
            return override;
        }

        return category == Category.WHATSAPP ? rateLimitProperties.getWhatsapp() : rateLimitProperties.getPayments();
    }

    private String getClientIp(HttpServletRequest request) {
        String forwardedFor = request.getHeader("X-Forwarded-For");

        if (forwardedFor != null && !forwardedFor.isEmpty()) {
            return forwardedFor.split(",")[0].trim();
        }

        return request.getRemoteAddr();
    }

    private enum Category {
        WHATSAPP,
        PAYMENTS
    }

    private static class TokenBucket {

        private final int maxTokens;

        private final long windowMs;

        private int tokens;

        private long lastRefillTime;

        TokenBucket(int maxTokens, long windowMs) {
            this.maxTokens = maxTokens;
            this.windowMs = windowMs;
            this.tokens = maxTokens;
            this.lastRefillTime = System.currentTimeMillis();
        }

        synchronized boolean tryConsume() {
            refill();

            if (tokens > 0) {
                tokens--;

                return true;
            }

            return false;
        }

        synchronized long getRetryAfterSeconds() {
            long elapsed = System.currentTimeMillis() - lastRefillTime;
            long remaining = windowMs - elapsed;

            return Math.max(1, remaining / 1000);
        }

        private void refill() {
            long now = System.currentTimeMillis();
            long elapsed = now - lastRefillTime;

            if (elapsed >= windowMs) {
                tokens = maxTokens;
                lastRefillTime = now;
            }
        }
    }

}
