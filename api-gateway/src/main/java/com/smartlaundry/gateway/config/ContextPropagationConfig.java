package com.smartlaundry.gateway.config;

import io.micrometer.context.ContextRegistry;
import jakarta.annotation.PostConstruct;
import org.slf4j.MDC;
import org.springframework.context.annotation.Configuration;

/**
 * Registers the {@code correlationId} Reactor Context key (set by
 * {@link com.smartlaundry.gateway.filter.CorrelationIdFilter}) as a
 * thread-local accessor so Spring's automatic context propagation copies it
 * into the SLF4J MDC of whichever thread handles each reactive step —
 * making it available to logback-spring.xml's JSON logs alongside the
 * traceId/spanId added by Micrometer Tracing.
 */
@Configuration
public class ContextPropagationConfig {

    public static final String CORRELATION_ID_CONTEXT_KEY = "correlationId";

    @PostConstruct
    void registerCorrelationIdAccessor() {
        ContextRegistry.getInstance().registerThreadLocalAccessor(
                CORRELATION_ID_CONTEXT_KEY,
                () -> MDC.get(CORRELATION_ID_CONTEXT_KEY),
                value -> MDC.put(CORRELATION_ID_CONTEXT_KEY, value),
                () -> MDC.remove(CORRELATION_ID_CONTEXT_KEY));
    }
}
