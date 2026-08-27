package com.smartlaundromat.reporting.config;

import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * R10 — HTTP caching headers for reporting-bff's admin API surface.
 *
 * <p>Every controller in this service lives under {@code /api/admin/**} (dashboard,
 * revenue, machines, users, absences, ...), so {@link NoStoreResponseFilter} applies
 * there unconditionally. {@link ConditionalCacheEtagFilter} is layered on top, but only
 * for the three read surfaces the dashboard actually polls repeatedly — the same
 * boundary R9's Redis cache uses (dashboard summary, revenue, machine reports) — so a
 * repeat poll for unchanged data gets a 304 instead of the full JSON payload, without
 * paying the response-body-buffering cost on write endpoints or the large transaction
 * CSV export.
 */
@Configuration(proxyBeanMethods = false)
public class CacheHeaderFilterConfig {

    private static final String ADMIN_API_PATTERN = "/api/admin/*";

    @Bean
    public FilterRegistrationBean<NoStoreResponseFilter> noStoreFilter() {
        FilterRegistrationBean<NoStoreResponseFilter> registration =
                new FilterRegistrationBean<>(new NoStoreResponseFilter());
        registration.addUrlPatterns(ADMIN_API_PATTERN);
        registration.setName("adminNoStoreFilter");
        registration.setOrder(10);

        return registration;
    }

    @Bean
    public FilterRegistrationBean<ConditionalCacheEtagFilter> etagFilter() {
        FilterRegistrationBean<ConditionalCacheEtagFilter> registration =
                new FilterRegistrationBean<>(new ConditionalCacheEtagFilter());
        registration.addUrlPatterns(
                "/api/admin/dashboard/*",
                "/api/admin/revenue/*",
                "/api/admin/machines",
                "/api/admin/machines/*");
        registration.setName("adminEtagFilter");
        registration.setOrder(20);

        return registration;
    }
}
