package com.smartlaundromat.reporting.config;

import org.junit.jupiter.api.Test;
import org.springframework.boot.web.servlet.FilterRegistrationBean;

import static org.assertj.core.api.Assertions.assertThat;

class CacheHeaderFilterConfigTest {

    private final CacheHeaderFilterConfig config = new CacheHeaderFilterConfig();

    @Test
    void shouldScopeNoStoreFilterToTheWholeAdminApi() {
        // when
        FilterRegistrationBean<NoStoreResponseFilter> registration = config.noStoreFilter();

        // then
        assertThat(registration.getUrlPatterns()).containsExactly("/api/admin/*");
    }

    @Test
    void shouldScopeEtagFilterToOnlyTheThreePolledReadSurfaces() {
        // when
        FilterRegistrationBean<ConditionalCacheEtagFilter> registration = config.etagFilter();

        // then — the same boundary R9's Redis cache uses (dashboard/revenue/machines),
        // deliberately excluding write endpoints and the transaction CSV export
        assertThat(registration.getUrlPatterns()).containsExactlyInAnyOrder(
                "/api/admin/dashboard/*",
                "/api/admin/revenue/*",
                "/api/admin/machines",
                "/api/admin/machines/*");
    }

    @Test
    void shouldRunNoStoreFilterBeforeTheEtagFilter() {
        // when
        int noStoreOrder = config.noStoreFilter().getOrder();
        int etagOrder = config.etagFilter().getOrder();

        // then
        assertThat(noStoreOrder).isLessThan(etagOrder);
    }
}
