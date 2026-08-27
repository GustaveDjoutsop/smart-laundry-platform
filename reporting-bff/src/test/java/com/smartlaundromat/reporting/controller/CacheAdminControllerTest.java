package com.smartlaundromat.reporting.controller;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@SuppressWarnings("unchecked")
class CacheAdminControllerTest {

    @Mock
    CacheManager cacheManager;

    @Mock
    Cache revenueTodayCache;

    @Mock
    Cache dashboardSummaryCache;

    CacheAdminController controller;

    @BeforeEach
    void setUp() {
        controller = new CacheAdminController(cacheManager);
    }

    @Test
    void shouldClearOnlyTheNamedCacheWhenNameIsGiven() {
        // given
        when(cacheManager.getCache("revenue-today")).thenReturn(revenueTodayCache);

        // when
        Map<String, Object> result = controller.evict("revenue-today");

        // then
        verify(revenueTodayCache).clear();
        assertThat((List<String>) result.get("evicted")).containsExactly("revenue-today");
        assertThat((List<String>) result.get("unknown")).isEmpty();
    }

    @Test
    void shouldReportUnknownWhenNamedCacheDoesNotExist() {
        // given
        when(cacheManager.getCache("nonexistent")).thenReturn(null);

        // when
        Map<String, Object> result = controller.evict("nonexistent");

        // then
        assertThat((List<String>) result.get("evicted")).isEmpty();
        assertThat((List<String>) result.get("unknown")).containsExactly("nonexistent");
    }

    @Test
    void shouldClearEveryManagedCacheWhenNoNameIsGiven() {
        // given
        when(cacheManager.getCacheNames()).thenReturn(Set.of("revenue-today", "dashboard-summary"));
        when(cacheManager.getCache("revenue-today")).thenReturn(revenueTodayCache);
        when(cacheManager.getCache("dashboard-summary")).thenReturn(dashboardSummaryCache);

        // when
        Map<String, Object> result = controller.evict(null);

        // then
        verify(revenueTodayCache).clear();
        verify(dashboardSummaryCache).clear();
        assertThat((List<String>) result.get("evicted")).containsExactlyInAnyOrder("revenue-today", "dashboard-summary");
    }
}
