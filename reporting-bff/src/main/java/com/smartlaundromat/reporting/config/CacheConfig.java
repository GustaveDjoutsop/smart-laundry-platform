package com.smartlaundromat.reporting.config;

import java.time.Duration;

import org.springframework.boot.autoconfigure.cache.RedisCacheManagerBuilderCustomizer;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.cache.interceptor.CacheErrorHandler;
import org.springframework.cache.interceptor.LoggingCacheErrorHandler;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.cache.RedisCacheConfiguration;
import org.springframework.data.redis.serializer.GenericJackson2JsonRedisSerializer;
import org.springframework.data.redis.serializer.RedisSerializationContext;

/**
 * Cache layer (R9). Reuses the Redis instance already running for gateway rate limiting
 * and bot conversation state — no new infrastructure.
 *
 * <p>Per-cache TTLs: {@code dashboard-summary} and {@code revenue-today} are short (60 s)
 * because they cover today's still-changing numbers; {@code revenue-daily} is long (24 h)
 * because a closed day's revenue is immutable — see {@link CacheNames} for what each name
 * actually holds and {@link com.smartlaundromat.reporting.service.RevenueService} for how
 * a query is routed to {@code revenue-daily} vs {@code revenue-today} depending on whether
 * its date range reaches into today.
 *
 * <p>{@link LoggingCacheErrorHandler} makes every {@code @Cacheable}/{@code @CacheEvict}
 * call degrade to "run the query" rather than fail the request when Redis itself is
 * unavailable — reporting is not worth an outage over. This only covers the
 * annotation-driven caches; {@code RevenueService}'s programmatic
 * {@code CacheManager.getCache(...).get(...)} calls handle the same degradation
 * themselves, since {@code CacheErrorHandler} only intercepts the AOP path.
 */
@Configuration(proxyBeanMethods = false)
@EnableCaching
public class CacheConfig {

    @Bean
    public RedisCacheManagerBuilderCustomizer cacheManagerBuilderCustomizer() {
        return builder -> builder
                .withCacheConfiguration(CacheNames.DASHBOARD_SUMMARY, baseConfig().entryTtl(Duration.ofSeconds(60)))
                .withCacheConfiguration(CacheNames.REVENUE_TODAY, baseConfig().entryTtl(Duration.ofSeconds(60)))
                .withCacheConfiguration(CacheNames.REVENUE_DAILY, baseConfig().entryTtl(Duration.ofHours(24)))
                .withCacheConfiguration(CacheNames.MACHINE_REPORT, baseConfig().entryTtl(Duration.ofMinutes(5)));
    }

    /**
     * JSON, not the JDK-serialization default — this is the first use of Spring's Cache
     * abstraction against Redis anywhere in this repo, so there's no prior convention to
     * match either way. JSON keeps cached values readable via {@code redis-cli} and, more
     * importantly, avoids a silent-failure mode: a value the JDK serializer can't handle
     * would throw on cache-put, which {@link LoggingCacheErrorHandler} swallows for the
     * annotation-driven caches — that cache would then silently never populate, always
     * falling through to the database, with only a log line as the symptom.
     */
    private RedisCacheConfiguration baseConfig() {
        return RedisCacheConfiguration.defaultCacheConfig()
                .serializeValuesWith(RedisSerializationContext.SerializationPair
                        .fromSerializer(new GenericJackson2JsonRedisSerializer()));
    }

    @Bean
    public CacheErrorHandler cacheErrorHandler() {
        return new LoggingCacheErrorHandler();
    }
}
