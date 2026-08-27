package com.smartlaundromat.reporting.service;

import com.smartlaundromat.reporting.config.CacheNames;
import com.smartlaundromat.reporting.config.ResilientCache;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Covers R9's closed-day-vs-today cache routing (the actual point of this class's
 * caching change) — not the underlying SQL, which is unchanged and untested here.
 */
@ExtendWith(MockitoExtension.class)
class RevenueServiceTest {

    @Mock
    NamedParameterJdbcTemplate jdbc;

    @Mock
    ResilientCache cache;

    RevenueService revenueService;

    @BeforeEach
    void setUp() {
        revenueService = new RevenueService(jdbc, cache);
        // lenient — each test below exercises exactly one of these two JDBC call
        // shapes (summary() uses queryForMap, the other four use queryForList), so
        // the other stub is legitimately unused in that test rather than dead.
        lenient().when(jdbc.queryForMap(anyString(), any(org.springframework.jdbc.core.namedparam.SqlParameterSource.class)))
                .thenReturn(Map.of("total_revenue", 0));
        lenient().when(jdbc.queryForList(anyString(), any(org.springframework.jdbc.core.namedparam.SqlParameterSource.class)))
                .thenReturn(List.of());
    }

    @Test
    void shouldRouteToRevenueDailyWhenEndDateIsEntirelyInThePast() {
        // given
        String yesterday = LocalDate.now().minusDays(1).toString();
        ArgumentCaptor<String> cacheNameCaptor = ArgumentCaptor.forClass(String.class);
        when(cache.get(cacheNameCaptor.capture(), anyString(), any())).thenAnswer(this::invokeLoader);

        // when
        revenueService.summary("2026-01-01", yesterday);

        // then
        assertThat(cacheNameCaptor.getValue()).isEqualTo(CacheNames.REVENUE_DAILY);
    }

    @Test
    void shouldRouteToRevenueTodayWhenEndDateIsToday() {
        // given
        String today = LocalDate.now().toString();
        ArgumentCaptor<String> cacheNameCaptor = ArgumentCaptor.forClass(String.class);
        when(cache.get(cacheNameCaptor.capture(), anyString(), any())).thenAnswer(this::invokeLoader);

        // when
        revenueService.byProvider("2026-01-01", today);

        // then
        assertThat(cacheNameCaptor.getValue()).isEqualTo(CacheNames.REVENUE_TODAY);
    }

    @Test
    void shouldRouteToRevenueTodayWhenEndDateIsNull() {
        // given — open-ended "up to now" always reaches into today
        ArgumentCaptor<String> cacheNameCaptor = ArgumentCaptor.forClass(String.class);
        when(cache.get(cacheNameCaptor.capture(), anyString(), any())).thenAnswer(this::invokeLoader);

        // when
        revenueService.byMachine("2026-01-01", null);

        // then
        assertThat(cacheNameCaptor.getValue()).isEqualTo(CacheNames.REVENUE_TODAY);
    }

    @Test
    void shouldRouteToRevenueTodayWhenEndDateIsUnparseable() {
        // given — on any doubt about the date, prefer the short-TTL bucket over risking
        // a 24h-stale cache entry
        ArgumentCaptor<String> cacheNameCaptor = ArgumentCaptor.forClass(String.class);
        when(cache.get(cacheNameCaptor.capture(), anyString(), any())).thenAnswer(this::invokeLoader);

        // when
        revenueService.byProgram("2026-01-01", "not-a-date");

        // then
        assertThat(cacheNameCaptor.getValue()).isEqualTo(CacheNames.REVENUE_TODAY);
    }

    @Test
    void shouldRouteTrendsToRevenueDailyWhenEndDateIsInThePast() {
        // given
        String yesterday = LocalDate.now().minusDays(1).toString();
        ArgumentCaptor<String> cacheNameCaptor = ArgumentCaptor.forClass(String.class);
        when(cache.get(cacheNameCaptor.capture(), anyString(), any())).thenAnswer(this::invokeLoader);

        // when
        revenueService.trends("day", "2026-01-01", yesterday);

        // then
        assertThat(cacheNameCaptor.getValue()).isEqualTo(CacheNames.REVENUE_DAILY);
        verify(jdbc).queryForList(anyString(), any(org.springframework.jdbc.core.namedparam.SqlParameterSource.class));
    }

    @SuppressWarnings("unchecked")
    private Object invokeLoader(org.mockito.invocation.InvocationOnMock invocation) {
        Supplier<Object> loader = invocation.getArgument(2);
        return loader.get();
    }
}
