package com.smartlaundromat.reporting.config;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.data.redis.RedisConnectionFailureException;

import java.util.concurrent.Callable;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ResilientCacheTest {

    @Mock
    CacheManager cacheManager;

    @Mock
    Cache cache;

    ResilientCache resilientCache;

    @BeforeEach
    void setUp() {
        resilientCache = new ResilientCache(cacheManager);
    }

    @Test
    void shouldReturnLoaderResultWhenCacheHitsOrMisses() {
        // given — delegate straight through to the real Cache.get(key, Callable) contract
        when(cacheManager.getCache("revenue-today")).thenReturn(cache);
        when(cache.get(anyString(), any(Callable.class)))
                .thenAnswer(inv -> ((Callable<?>) inv.getArgument(1)).call());

        // when
        String result = resilientCache.get("revenue-today", "key-1", () -> "loaded-value");

        // then
        assertThat(result).isEqualTo("loaded-value");
    }

    @Test
    void shouldCallLoaderDirectlyWhenCacheNameIsUnknown() {
        // given
        when(cacheManager.getCache("nonexistent")).thenReturn(null);
        AtomicInteger loaderCalls = new AtomicInteger();

        // when
        String result = resilientCache.get("nonexistent", "key-1", () -> {
            loaderCalls.incrementAndGet();
            return "loaded-value";
        });

        // then
        assertThat(result).isEqualTo("loaded-value");
        assertThat(loaderCalls.get()).isEqualTo(1);
    }

    @Test
    void shouldFallThroughToLoaderWhenCacheThrows() {
        // given — Redis unreachable; the request must not fail because of it
        when(cacheManager.getCache("revenue-today")).thenReturn(cache);
        when(cache.get(anyString(), any(Callable.class)))
                .thenThrow(new RedisConnectionFailureException("connection refused"));

        // when
        String result = resilientCache.get("revenue-today", "key-1", () -> "loaded-value");

        // then
        assertThat(result).isEqualTo("loaded-value");
    }
}
