package com.smartlaundry.gateway.filter;

import lombok.Getter;
import lombok.Setter;
import org.springframework.cloud.gateway.filter.GatewayFilter;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.factory.AbstractGatewayFilterFactory;
import org.springframework.cloud.gateway.filter.ratelimit.KeyResolver;
import org.springframework.cloud.gateway.filter.ratelimit.RateLimiter;
import org.springframework.cloud.gateway.filter.ratelimit.RedisRateLimiter;
import org.springframework.cloud.gateway.support.HasRouteId;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.server.reactive.ServerHttpResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import java.nio.charset.StandardCharsets;

/**
 * Drop-in replacement for the stock {@code RequestRateLimiter} filter: same Redis-backed
 * token-bucket algorithm (delegates to the same {@link RedisRateLimiter} bean), same
 * per-route {@code replenishRate}/{@code burstCapacity} config and {@code X-RateLimit-*}
 * response headers — but with a denied (429) response that actually carries a
 * {@code Retry-After} header and a JSON body (R11 item 3), matching
 * spring-bot-manager-only's own {@code RateLimitFilter} response shape.
 *
 * <p>The stock {@code RequestRateLimiterGatewayFilterFactory} (checked against the
 * actual 4.3.0 jar) sets only the status code on deny and completes the response with an
 * empty body — by the time control could return to a filter wrapping it, the response is
 * already committed, so there's no way to add a body after the fact. This factory owns
 * the whole response instead of wrapping the stock one, so it can.
 */
@Component
public class TenantRateLimiterGatewayFilterFactory
        extends AbstractGatewayFilterFactory<TenantRateLimiterGatewayFilterFactory.Config> {

    private final RedisRateLimiter redisRateLimiter;

    private final KeyResolver keyResolver;

    public TenantRateLimiterGatewayFilterFactory(RedisRateLimiter redisRateLimiter, KeyResolver keyResolver) {
        super(Config.class);

        this.redisRateLimiter = redisRateLimiter;
        this.keyResolver = keyResolver;
    }

    @Override
    public GatewayFilter apply(Config config) {
        redisRateLimiter.getConfig().put(config.getRouteId(), toRedisConfig(config));
        long retryAfterSeconds = retryAfterSecondsFor(config.getReplenishRate());

        return (exchange, chain) -> keyResolver.resolve(exchange)
                .defaultIfEmpty("unknown")
                .flatMap(key -> redisRateLimiter.isAllowed(config.getRouteId(), key))
                .flatMap(response -> onResponse(exchange, chain, response, retryAfterSeconds));
    }

    /** Conservative estimate of when the next token becomes available at steady state. */
    private long retryAfterSecondsFor(int replenishRate) {
        return Math.max(1, (long) Math.ceil(1.0 / Math.max(1, replenishRate)));
    }

    private Mono<Void> onResponse(ServerWebExchange exchange, GatewayFilterChain chain,
                                   RateLimiter.Response response, long retryAfterSeconds) {
        HttpHeaders responseHeaders = exchange.getResponse().getHeaders();
        response.getHeaders().forEach(responseHeaders::add);

        if (response.isAllowed()) {
            return chain.filter(exchange);
        }

        return denyWithRetryAfter(exchange, retryAfterSeconds);
    }

    private Mono<Void> denyWithRetryAfter(ServerWebExchange exchange, long retryAfterSeconds) {
        ServerHttpResponse httpResponse = exchange.getResponse();
        httpResponse.setStatusCode(HttpStatus.TOO_MANY_REQUESTS);
        httpResponse.getHeaders().setContentType(MediaType.APPLICATION_JSON);
        httpResponse.getHeaders().set(HttpHeaders.RETRY_AFTER, String.valueOf(retryAfterSeconds));

        String body = "{\"error\":\"Too Many Requests\",\"retryAfter\":" + retryAfterSeconds + "}";
        DataBuffer buffer = httpResponse.bufferFactory().wrap(body.getBytes(StandardCharsets.UTF_8));

        return httpResponse.writeWith(Mono.just(buffer));
    }

    private RedisRateLimiter.Config toRedisConfig(Config config) {
        return new RedisRateLimiter.Config()
                .setReplenishRate(config.getReplenishRate())
                .setBurstCapacity(config.getBurstCapacity())
                .setRequestedTokens(config.getRequestedTokens());
    }

    @Getter
    @Setter
    public static class Config implements HasRouteId {

        private String routeId;

        private int replenishRate;

        private int burstCapacity = 1;

        private int requestedTokens = 1;
    }
}
