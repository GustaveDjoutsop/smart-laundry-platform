package com.smartlaundry.gateway.config;

import org.springframework.cloud.gateway.filter.ratelimit.KeyResolver;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.security.core.context.ReactiveSecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Resolves the bucket key for {@code TenantRateLimiter} (R11). Previously every
 * unauthenticated request bucketed by client IP alone — harmless for genuinely
 * IP-distinct traffic, but WhatsApp/payment-provider webhooks all arrive from the
 * sender's own shared infrastructure IPs, so every tenant using the {@code bot-manager}
 * route shared *one* bucket: a flood on one tenant's bot could exhaust the budget for
 * every other tenant on the same route. This resolver keys by an actual tenant/caller
 * identity instead:
 *
 * <ul>
 *   <li>M2M (Auth0 client-credentials) traffic — keyed by the calling client's
 *       {@code azp} claim, so one noisy service-to-service caller can't exhaust another
 *       service's budget.</li>
 *   <li>Authenticated end-user traffic (dashboard, via Auth0 authorization-code tokens)
 *       — keyed by {@code sub}, same as before.</li>
 *   <li>Unauthenticated WhatsApp/payment-webhook traffic — keyed by the tenant/bot ID
 *       embedded in the path (spring-bot-manager-only's {@code {botKey}}/{@code {botId}}
 *       path-scoped webhook routes, e.g. {@code /bot/api/whatsapp/webhooks/{botKey}}).
 *       Falls back to client IP when no tenant ID is present in the path — the legacy,
 *       non-tenant-scoped root WhatsApp webhook path is the one case this doesn't cover;
 *       see the R11 PR description.</li>
 * </ul>
 */
@Configuration(proxyBeanMethods = false)
public class RateLimiterConfig {

    private static final String GRANT_TYPE_CLAIM = "gty";

    private static final String M2M_GRANT_TYPE = "client-credentials";

    private static final String AUTHORIZED_PARTY_CLAIM = "azp";

    // Matches the botKey/botId segment of spring-bot-manager-only's tenant-scoped routes
    // as seen by the gateway, i.e. before StripPrefix removes the leading "/bot":
    //   /bot/api/whatsapp/webhooks/{botKey}
    //   /bot/api/payments/webhooks/{provider}/{botId}
    //   /bot/api/payments/{botId}/...
    private static final Pattern BOT_TENANT_PATTERN = Pattern.compile(
            "^/bot/api/(?:whatsapp/webhooks/|payments/(?:webhooks/[^/]+/|))([^/]+)");

    @Bean
    @Primary
    public KeyResolver tenantAwareKeyResolver() {
        return exchange -> ReactiveSecurityContextHolder.getContext()
                .map(context -> context.getAuthentication())
                .filter(auth -> auth != null && auth.getPrincipal() instanceof Jwt)
                .map(auth -> resolveJwtKey((Jwt) auth.getPrincipal()))
                .switchIfEmpty(Mono.fromSupplier(() -> resolveUnauthenticatedKey(exchange)))
                .defaultIfEmpty("unknown");
    }

    private String resolveJwtKey(Jwt jwt) {
        if (M2M_GRANT_TYPE.equals(jwt.getClaimAsString(GRANT_TYPE_CLAIM))) {
            String clientId = jwt.getClaimAsString(AUTHORIZED_PARTY_CLAIM);

            return "client:" + (clientId != null ? clientId : jwt.getSubject());
        }

        return "user:" + jwt.getSubject();
    }

    private String resolveUnauthenticatedKey(ServerWebExchange exchange) {
        String path = exchange.getRequest().getPath().value();
        Matcher matcher = BOT_TENANT_PATTERN.matcher(path);
        if (matcher.find()) {
            return "bot:" + matcher.group(1);
        }

        return "ip:" + resolveClientIp(exchange);
    }

    private String resolveClientIp(ServerWebExchange exchange) {
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
