package com.smartlaundromat.machine.config;

import io.sentry.EventProcessor;
import io.sentry.Hint;
import io.sentry.SentryEvent;
import org.slf4j.MDC;
import org.springframework.stereotype.Component;

/**
 * R7: tags every Sentry event with this request's correlation ID, already
 * present in the SLF4J MDC via {@link CorrelationIdFilter}, so a Sentry
 * issue links straight back to the matching structured log lines.
 */
@Component
public class SentryCorrelationIdEventProcessor implements EventProcessor {

    @Override
    public SentryEvent process(SentryEvent event, Hint hint) {
        String correlationId = MDC.get(CorrelationIdFilter.MDC_KEY);

        if (correlationId != null) {
            event.setTag(CorrelationIdFilter.MDC_KEY, correlationId);
        }

        return event;
    }
}
