package com.smartlaundry.gateway.filter;

import com.smartlaundry.gateway.config.ContextPropagationConfig;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import java.util.UUID;

/**
 * Ensures every request carries an {@code X-Correlation-Id}: reuses the
 * caller's value if present, otherwise generates one. The ID is forwarded to
 * the backend and echoed back on the response. Runs first so the ID is
 * available to every other filter and to access logs.
 */
@Component
public class CorrelationIdFilter implements GlobalFilter, Ordered {

    public static final String HEADER = "X-Correlation-Id";

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String correlationId = exchange.getRequest().getHeaders().getFirst(HEADER);
        if (correlationId == null || correlationId.isBlank()) {
            correlationId = UUID.randomUUID().toString();
        }
        final String finalCorrelationId = correlationId;

        ServerHttpRequest request = exchange.getRequest().mutate()
                .header(HEADER, finalCorrelationId)
                .build();

        exchange.getResponse().getHeaders().set(HEADER, finalCorrelationId);

        return chain.filter(exchange.mutate().request(request).build())
                .contextWrite(context -> context.put(
                        ContextPropagationConfig.CORRELATION_ID_CONTEXT_KEY, finalCorrelationId));
    }

    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE;
    }
}
