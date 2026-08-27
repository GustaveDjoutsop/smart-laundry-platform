package com.smartlaundromat.reporting.config;

import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.assertj.core.api.Assertions.assertThat;

class ConditionalCacheEtagFilterTest {

    private final ConditionalCacheEtagFilter filter = new ConditionalCacheEtagFilter();

    @Test
    void shouldBeEligibleForEtagOnGetEvenWhenResponseAlreadyCarriesNoStore() {
        // given
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/admin/revenue/summary");
        MockHttpServletResponse response = new MockHttpServletResponse();
        response.setHeader("Cache-Control", "no-store");

        // when — this is the whole point of the subclass: Spring's stock
        // ShallowEtagHeaderFilter would return false here because of the no-store header
        boolean eligible = filter.isEligibleForEtag(request, response, 200, null);

        // then
        assertThat(eligible).isTrue();
    }

    @Test
    void shouldNotBeEligibleForEtagOnNonGetRequest() {
        // given
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/admin/revenue/summary");
        MockHttpServletResponse response = new MockHttpServletResponse();

        // when
        boolean eligible = filter.isEligibleForEtag(request, response, 200, null);

        // then
        assertThat(eligible).isFalse();
    }

    @Test
    void shouldNotBeEligibleForEtagOnNonSuccessStatus() {
        // given
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/admin/revenue/summary");
        MockHttpServletResponse response = new MockHttpServletResponse();

        // when
        boolean eligible = filter.isEligibleForEtag(request, response, 500, null);

        // then
        assertThat(eligible).isFalse();
    }

    @Test
    void shouldNotBeEligibleForEtagOnAlreadyCommittedResponse() {
        // given — the one safety check kept from the parent class: a committed response
        // means content was already written straight to the real stream (e.g. streaming
        // disabled the content-caching wrapper), so there's nothing buffered left to hash
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/admin/revenue/summary");
        MockHttpServletResponse response = new MockHttpServletResponse();
        response.setCommitted(true);

        // when
        boolean eligible = filter.isEligibleForEtag(request, response, 200, null);

        // then
        assertThat(eligible).isFalse();
    }

    @Test
    void shouldReturn304WhenIfNoneMatchMatchesThePreviouslyIssuedEtag() throws Exception {
        // given — first request establishes the ETag
        MockHttpServletRequest firstRequest = new MockHttpServletRequest("GET", "/api/admin/revenue/summary");
        MockHttpServletResponse firstResponse = new MockHttpServletResponse();
        filter.doFilter(firstRequest, firstResponse, writingChain("{\"revenue\":100}"));
        String etag = firstResponse.getHeader("ETag");
        assertThat(etag).isNotBlank();

        // when — second request replays it as If-None-Match
        MockHttpServletRequest secondRequest = new MockHttpServletRequest("GET", "/api/admin/revenue/summary");
        secondRequest.addHeader("If-None-Match", etag);
        MockHttpServletResponse secondResponse = new MockHttpServletResponse();
        filter.doFilter(secondRequest, secondResponse, writingChain("{\"revenue\":100}"));

        // then
        assertThat(secondResponse.getStatus()).isEqualTo(304);
    }

    private FilterChain writingChain(String body) {
        return (req, res) -> {
            res.setContentType("application/json");
            res.getWriter().write(body);
        };
    }
}
