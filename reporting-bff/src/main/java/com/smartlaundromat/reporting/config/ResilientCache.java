package com.smartlaundromat.reporting.config;

import java.util.function.Supplier;

import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.stereotype.Component;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * Programmatic cache-aside helper (R9), for the one caller that needs to pick a cache
 * *name* at runtime ({@link com.smartlaundromat.reporting.service.RevenueService}, which
 * routes a query to {@code revenue-daily} or {@code revenue-today} depending on whether
 * its date range reaches into today — {@code @Cacheable}'s {@code cacheNames} can't be
 * chosen dynamically like that).
 *
 * <p>{@code @Cacheable}'s degradation-on-Redis-failure is handled by the
 * {@code CacheErrorHandler} bean in {@link CacheConfig}; this class provides the
 * equivalent for the programmatic path, since {@code CacheErrorHandler} only intercepts
 * the AOP-driven annotations, not direct {@code Cache} API calls.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class ResilientCache {

    private final CacheManager cacheManager;

    /**
     * Returns the cached value for {@code key} in {@code cacheName}, computing and
     * storing it via {@code loader} on a miss. Falls through to {@code loader} directly
     * — without failing the caller — if the cache itself is unreachable (e.g. Redis
     * down): reporting is not worth an outage over.
     */
    public <T> T get(String cacheName, Object key, Supplier<T> loader) {
        Cache cache = cacheManager.getCache(cacheName);

        if (cache == null) {
            return loader.get();
        }

        try {
            return cache.get(key, loader::get);
        } catch (RuntimeException exception) {
            log.warn("Cache '{}' unavailable, falling through to source: {}", cacheName, exception.getMessage());

            return loader.get();
        }
    }
}
