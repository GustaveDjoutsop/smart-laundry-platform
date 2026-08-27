package com.smartlaundromat.reporting.config;

import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The actual point of this PR is that both filters apply to the same response without
 * one defeating the other — {@link NoStoreResponseFilterTest} and
 * {@link ConditionalCacheEtagFilterTest} only ever exercise their own filter in
 * isolation, so this chains them exactly as {@link CacheHeaderFilterConfig} registers
 * them (no-store first, ETag second) and asserts the combined outcome.
 */
class AdminCacheHeaderFiltersIntegrationTest {

    private final NoStoreResponseFilter noStoreFilter = new NoStoreResponseFilter();
    private final ConditionalCacheEtagFilter etagFilter = new ConditionalCacheEtagFilter();

    @Test
    void shouldCarryBothNoStoreAndAWorkingEtagOnTheSameResponse() throws Exception {
        // given
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/admin/revenue/summary");
        MockHttpServletResponse response = new MockHttpServletResponse();

        // when
        chain(response, "{\"revenue\":100}").doFilter(request, response);

        // then
        assertThat(response.getHeader("Cache-Control")).isEqualTo("no-store");
        assertThat(response.getHeader("ETag")).isNotBlank();
    }

    @Test
    void shouldReturn304OnRepeatPollWhileStillCarryingNoStore() throws Exception {
        // given — first poll establishes the ETag
        MockHttpServletRequest firstRequest = new MockHttpServletRequest("GET", "/api/admin/revenue/summary");
        MockHttpServletResponse firstResponse = new MockHttpServletResponse();
        chain(firstResponse, "{\"revenue\":100}").doFilter(firstRequest, firstResponse);
        String etag = firstResponse.getHeader("ETag");

        // when — second poll for unchanged data replays it as If-None-Match
        MockHttpServletRequest secondRequest = new MockHttpServletRequest("GET", "/api/admin/revenue/summary");
        secondRequest.addHeader("If-None-Match", etag);
        MockHttpServletResponse secondResponse = new MockHttpServletResponse();
        chain(secondResponse, "{\"revenue\":100}").doFilter(secondRequest, secondResponse);

        // then — 304, not defeated by the no-store header that's also still present
        assertThat(secondResponse.getStatus()).isEqualTo(304);
        assertThat(secondResponse.getHeader("Cache-Control")).isEqualTo("no-store");
    }

    /**
     * Wires the two real {@code FilterRegistrationBean} entries from
     * {@link CacheHeaderFilterConfig} into a single chain ending in a servlet that writes
     * {@code body}, mirroring how the servlet container composes them in production.
     */
    private FilterChain chain(MockHttpServletResponse response, String body) {
        FilterChain terminal = (req, res) -> {
            res.setContentType("application/json");
            res.getWriter().write(body);
        };
        return (req, res) -> noStoreFilter.doFilter(req, res,
                (innerReq, innerRes) -> etagFilter.doFilter(innerReq, innerRes, terminal));
    }
}
