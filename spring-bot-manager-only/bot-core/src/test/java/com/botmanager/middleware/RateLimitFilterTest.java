package com.botmanager.middleware;

import com.botmanager.config.RateLimitProperties;
import com.botmanager.core.bot.BaseBot;
import com.botmanager.core.bot.BotConfig;
import com.botmanager.core.bot.BotLookup;
import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class RateLimitFilterTest {

    @Mock
    BotLookup botLookup;

    RateLimitFilter filter;

    @BeforeEach
    void setUp() {
        RateLimitProperties properties = new RateLimitProperties();
        properties.setWhatsapp(new RateLimitProperties.EndpointLimit(60_000, 1));
        properties.setPayments(new RateLimitProperties.EndpointLimit(60_000, 1));
        filter = new RateLimitFilter(properties, botLookup);
        lenient().when(botLookup.getBotByName(org.mockito.ArgumentMatchers.anyString())).thenReturn(Optional.empty());
    }

    @Test
    void shouldPassThroughRequestsOutsideRateLimitedCategories() throws Exception {
        // given
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/health");
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = mock(FilterChain.class);

        // when
        filter.doFilter(request, response, chain);

        // then
        verify(chain).doFilter(request, response);
    }

    @Test
    void shouldNotLetOneTenantsFloodExhaustAnothersBudgetOnTheSameRoute() throws Exception {
        // given — this is the actual property R11 buys: with maxRequests=1, tenant A's
        // second request must be denied while tenant B's first request still succeeds,
        // even though both arrive from the same source IP (as real webhook traffic does)
        String sharedIp = "3.3.3.3";

        // when
        boolean tenantAFirstCall = requestAllowed("/api/whatsapp/webhooks/pharmacy", sharedIp);
        boolean tenantASecondCall = requestAllowed("/api/whatsapp/webhooks/pharmacy", sharedIp);
        boolean tenantBFirstCall = requestAllowed("/api/whatsapp/webhooks/laundry", sharedIp);

        // then
        assertThat(tenantAFirstCall).isTrue();
        assertThat(tenantASecondCall).isFalse();
        assertThat(tenantBFirstCall).isTrue();
    }

    @Test
    void shouldReturn429WithRetryAfterAndAClearBodyWhenBucketExhausted() throws Exception {
        // given
        assertThat(requestAllowed("/api/whatsapp/webhooks/pharmacy", "1.1.1.1")).isTrue();
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/whatsapp/webhooks/pharmacy");
        request.setRemoteAddr("1.1.1.1");
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = mock(FilterChain.class);

        // when
        filter.doFilter(request, response, chain);

        // then
        assertThat(response.getStatus()).isEqualTo(429);
        assertThat(response.getHeader("Retry-After")).isNotBlank();
        assertThat(response.getContentAsString()).contains("\"error\":\"Too Many Requests\"");
        verify(chain, org.mockito.Mockito.never()).doFilter(request, response);
    }

    @Test
    void shouldExtractBotIdFromProviderScopedPaymentWebhookPath() throws Exception {
        // given
        String path = "/api/payments/webhooks/campay/pharmacy";

        // when
        boolean first = requestAllowed(path, "5.5.5.5");
        boolean second = requestAllowed(path, "5.5.5.5");
        boolean otherTenant = requestAllowed("/api/payments/webhooks/campay/laundry", "5.5.5.5");

        // then
        assertThat(first).isTrue();
        assertThat(second).isFalse();
        assertThat(otherTenant).isTrue();
    }

    @Test
    void shouldExtractBotIdFromBotScopedTransactionStatusPath() throws Exception {
        // given
        String path = "/api/payments/pharmacy/transactions/txn-123";

        // when
        boolean first = requestAllowed(path, "6.6.6.6");
        boolean second = requestAllowed(path, "6.6.6.6");

        // then
        assertThat(first).isTrue();
        assertThat(second).isFalse();
    }

    @Test
    void shouldFallBackToClientIpForTheLegacyNonTenantScopedWhatsappRootPath() throws Exception {
        // given — a known, disclosed gap: no botKey segment to bucket by
        boolean fromFirstIp = requestAllowed("/api/whatsapp/webhook", "7.7.7.7");
        boolean fromSecondIp = requestAllowed("/api/whatsapp/webhook", "8.8.8.8");

        // then — still isolated, just by IP instead of tenant
        assertThat(fromFirstIp).isTrue();
        assertThat(fromSecondIp).isTrue();
    }

    @Test
    void shouldUseTheBotsOwnRateLimitOverrideInsteadOfTheGlobalDefault() throws Exception {
        // given — pharmacy configures a stricter whatsapp limit than the global default
        BotConfig config = new BotConfig();
        BotConfig.RateLimitOverrides overrides = new BotConfig.RateLimitOverrides();
        overrides.setWhatsapp(new RateLimitProperties.EndpointLimit(60_000, 0));
        config.setRateLimit(overrides);
        BaseBot bot = mock(BaseBot.class);
        when(bot.getConfig()).thenReturn(config);
        when(botLookup.getBotByName("pharmacy")).thenReturn(Optional.of(bot));

        // when — the override's maxRequests=0 means even the first request is denied
        boolean allowed = requestAllowed("/api/whatsapp/webhooks/pharmacy", "9.9.9.9");

        // then
        assertThat(allowed).isFalse();
    }

    private boolean requestAllowed(String path, String remoteAddr) throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", path);
        request.setRemoteAddr(remoteAddr);
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = mock(FilterChain.class);

        filter.doFilter(request, response, chain);

        return response.getStatus() != 429;
    }
}
