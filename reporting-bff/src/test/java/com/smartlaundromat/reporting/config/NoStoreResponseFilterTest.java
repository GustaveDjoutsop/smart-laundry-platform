package com.smartlaundromat.reporting.config;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.assertj.core.api.Assertions.assertThat;

class NoStoreResponseFilterTest {

    private final NoStoreResponseFilter filter = new NoStoreResponseFilter();

    @Test
    void shouldSetNoStoreHeaderAndContinueTheChain() throws Exception {
        // given
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/admin/revenue/summary");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        // when
        filter.doFilter(request, response, chain);

        // then
        assertThat(response.getHeader(HttpHeaders.CACHE_CONTROL)).isEqualTo("no-store");
        assertThat(chain.getRequest()).isEqualTo(request);
    }
}
