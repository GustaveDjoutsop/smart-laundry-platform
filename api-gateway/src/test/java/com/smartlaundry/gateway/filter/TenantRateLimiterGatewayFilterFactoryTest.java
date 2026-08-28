package com.smartlaundry.gateway.filter;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.cloud.gateway.filter.GatewayFilter;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.ratelimit.KeyResolver;
import org.springframework.cloud.gateway.filter.ratelimit.RateLimiter;
import org.springframework.cloud.gateway.filter.ratelimit.RedisRateLimiter;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.http.server.reactive.MockServerHttpResponse;
import org.springframework.mock.web.server.MockServerWebExchange;
import reactor.core.publisher.Mono;

import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class TenantRateLimiterGatewayFilterFactoryTest {

    @Mock
    RedisRateLimiter redisRateLimiter;

    @Mock
    KeyResolver keyResolver;

    TenantRateLimiterGatewayFilterFactory factory;

    @BeforeEach
    void setUp() {
        factory = new TenantRateLimiterGatewayFilterFactory(redisRateLimiter, keyResolver);
        // lenient — shouldRegisterThePerRouteRedisConfigOnApply only exercises apply()
        // itself (with its own getConfig() stub) and never invokes the returned filter,
        // so it legitimately never touches either of these
        lenient().when(redisRateLimiter.getConfig()).thenReturn(new HashMap<>());
        lenient().when(keyResolver.resolve(any())).thenReturn(Mono.just("bot:pharmacy"));
    }

    @Test
    void shouldForwardTheRequestWhenAllowed() {
        // given
        when(redisRateLimiter.isAllowed(anyString(), anyString()))
                .thenReturn(Mono.just(new RateLimiter.Response(true, Map.of("X-RateLimit-Remaining", "1"))));
        GatewayFilter filter = factory.apply(configFor(2, 120));
        MockServerWebExchange exchange = MockServerWebExchange.from(
                MockServerHttpRequest.post("/bot/api/whatsapp/webhooks/pharmacy"));
        GatewayFilterChain chain = mock(GatewayFilterChain.class);
        when(chain.filter(any())).thenReturn(Mono.empty());

        // when
        filter.filter(exchange, chain).block();

        // then
        assertThat(exchange.getResponse().getHeaders().getFirst("X-RateLimit-Remaining")).isEqualTo("1");
        assertThat(exchange.getResponse().getStatusCode()).isNull();
    }

    @Test
    void shouldReturn429WithRetryAfterAndAJsonBodyWhenDenied() {
        // given — item 3: a clear, gracefully-degrading failure, not an opaque one
        when(redisRateLimiter.isAllowed(anyString(), anyString()))
                .thenReturn(Mono.just(new RateLimiter.Response(false, Map.of())));
        GatewayFilter filter = factory.apply(configFor(2, 120));
        MockServerWebExchange exchange = MockServerWebExchange.from(
                MockServerHttpRequest.post("/bot/api/whatsapp/webhooks/pharmacy"));
        GatewayFilterChain chain = mock(GatewayFilterChain.class);

        // when
        filter.filter(exchange, chain).block();

        // then
        assertThat(exchange.getResponse().getStatusCode()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
        assertThat(exchange.getResponse().getHeaders().getFirst(HttpHeaders.RETRY_AFTER)).isEqualTo("1");
        assertThat(exchange.getResponse().getHeaders().getContentType().toString()).contains("application/json");

        String body = ((MockServerHttpResponse) exchange.getResponse()).getBodyAsString().block();
        assertThat(body).contains("\"error\":\"Too Many Requests\"", "\"retryAfter\":1");
    }

    @Test
    void shouldFloorRetryAfterAtOneSecondEvenWhenReplenishRateIsZeroOrInvalid() {
        // given — a misconfigured route (replenishRate 0) must never advertise a
        // Retry-After of 0 or a division-by-zero blowup
        when(redisRateLimiter.isAllowed(anyString(), anyString()))
                .thenReturn(Mono.just(new RateLimiter.Response(false, Map.of())));
        GatewayFilter filter = factory.apply(configFor(0, 1));
        MockServerWebExchange exchange = MockServerWebExchange.from(
                MockServerHttpRequest.post("/bot/api/whatsapp/webhooks/pharmacy"));
        GatewayFilterChain chain = mock(GatewayFilterChain.class);

        // when
        filter.filter(exchange, chain).block();

        // then
        assertThat(exchange.getResponse().getHeaders().getFirst(HttpHeaders.RETRY_AFTER)).isEqualTo("1");
    }

    @Test
    void shouldRegisterThePerRouteRedisConfigOnApply() {
        // given
        Map<String, RedisRateLimiter.Config> configStore = new HashMap<>();
        when(redisRateLimiter.getConfig()).thenReturn(configStore);

        // when
        factory.apply(configFor(2, 120));

        // then
        RedisRateLimiter.Config registered = configStore.get("bot-manager");
        assertThat(registered.getReplenishRate()).isEqualTo(2);
        assertThat(registered.getBurstCapacity()).isEqualTo(120);
    }

    private TenantRateLimiterGatewayFilterFactory.Config configFor(int replenishRate, int burstCapacity) {
        TenantRateLimiterGatewayFilterFactory.Config config = new TenantRateLimiterGatewayFilterFactory.Config();
        config.setRouteId("bot-manager");
        config.setReplenishRate(replenishRate);
        config.setBurstCapacity(burstCapacity);

        return config;
    }
}
