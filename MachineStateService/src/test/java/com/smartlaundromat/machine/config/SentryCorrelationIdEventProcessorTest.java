package com.smartlaundromat.machine.config;

import io.sentry.Hint;
import io.sentry.SentryEvent;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;

import static org.assertj.core.api.Assertions.assertThat;

class SentryCorrelationIdEventProcessorTest {

    private final SentryCorrelationIdEventProcessor processor = new SentryCorrelationIdEventProcessor();

    @AfterEach
    void clearMdc() {
        MDC.clear();
    }

    @Test
    void shouldTagEventWithCorrelationIdWhenPresentInMdc() {
        // given
        MDC.put(CorrelationIdFilter.MDC_KEY, "corr-123");
        SentryEvent event = new SentryEvent();

        // when
        SentryEvent result = processor.process(event, new Hint());

        // then
        assertThat(result.getTag(CorrelationIdFilter.MDC_KEY)).isEqualTo("corr-123");
    }

    @Test
    void shouldNotSetTagWhenCorrelationIdAbsentFromMdc() {
        // given
        SentryEvent event = new SentryEvent();

        // when
        SentryEvent result = processor.process(event, new Hint());

        // then
        assertThat(result.getTag(CorrelationIdFilter.MDC_KEY)).isNull();
    }
}
