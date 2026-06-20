package com.botmanager.middleware;

import com.botmanager.config.RateLimitProperties;
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
import java.util.concurrent.ConcurrentHashMap;

@Slf4j
@Component
@RequiredArgsConstructor
public class RateLimitFilter extends OncePerRequestFilter {

    private final RateLimitProperties rateLimitProperties;

    private final Map<String, TokenBucket> buckets = new ConcurrentHashMap<>();

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {

        String path = request.getRequestURI();
        String clientIp = getClientIp(request);

        RateLimitProperties.EndpointLimit limit = getEndpointLimit(path);
        if (limit == null) {
            filterChain.doFilter(request, response);

            return;
        }

        String bucketKey = path + ":" + clientIp;
        TokenBucket bucket = buckets.computeIfAbsent(bucketKey,
                k -> new TokenBucket(limit.getMaxRequests(), limit.getWindowMs()));

        if (!bucket.tryConsume()) {
            long retryAfter = bucket.getRetryAfterSeconds();
            response.setStatus(429);
            response.setHeader("Retry-After", String.valueOf(retryAfter));
            response.setContentType("application/json");
            response.getWriter().write("{\"error\":\"Too Many Requests\",\"retryAfter\":" + retryAfter + "}");

            log.warn("Rate limit exceeded for {} from {}", path, clientIp);

            return;
        }

        filterChain.doFilter(request, response);
    }

    private RateLimitProperties.EndpointLimit getEndpointLimit(String path) {
        if (path.contains("/whatsapp")) {
            return rateLimitProperties.getWhatsapp();
        }

        if (path.contains("/payments")) {
            return rateLimitProperties.getPayments();
        }

        return null;
    }

    private String getClientIp(HttpServletRequest request) {
        String forwardedFor = request.getHeader("X-Forwarded-For");

        if (forwardedFor != null && !forwardedFor.isEmpty()) {
            return forwardedFor.split(",")[0].trim();
        }

        return request.getRemoteAddr();
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
