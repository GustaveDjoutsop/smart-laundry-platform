package com.botmanager.core.redis;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.time.Duration;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

@Slf4j
@Component
@RequiredArgsConstructor
public class RedisManager {

    private final StringRedisTemplate redisTemplate;

    private final ObjectMapper objectMapper;

    private final Map<String, CacheEntry> inMemoryCache = new ConcurrentHashMap<>();

    private boolean redisAvailable = false;

    @PostConstruct
    void init() {
        try {
            String pong = redisTemplate.getConnectionFactory().getConnection().ping();
            redisAvailable = StringUtils.hasText(pong);
            log.info("Redis connection established");
        } catch (Exception exception) {
            log.warn("Redis not available, using in-memory fallback: {}", exception.getMessage());
            redisAvailable = false;
        }
    }

    public boolean isRedisAvailable() {
        return redisAvailable;
    }

    public Optional<String> get(String key) {
        if (redisAvailable) {
            try {
                String value = redisTemplate.opsForValue().get(key);

                return Optional.ofNullable(value);
            } catch (Exception exception) {
                log.warn("Redis get failed for key {}: {}", key, exception.getMessage());
            }
        }

        CacheEntry entry = inMemoryCache.get(key);
        if (entry != null && !entry.isExpired()) {
            return Optional.of(entry.getValue());
        }

        inMemoryCache.remove(key);

        return Optional.empty();
    }

    public <T> Optional<T> get(String key, Class<T> type) {
        return get(key).map(value -> {
            try {
                return objectMapper.readValue(value, type);
            } catch (JsonProcessingException exception) {
                log.warn("Failed to deserialize value for key {}: {}", key, exception.getMessage());

                return null;
            }
        });
    }

    public void set(String key, String value) {
        if (redisAvailable) {
            try {
                redisTemplate.opsForValue().set(key, value);

                return;
            } catch (Exception exception) {
                log.warn("Redis set failed for key {}: {}", key, exception.getMessage());
            }
        }

        inMemoryCache.put(key, new CacheEntry(value, null));
    }

    public void setWithExpiry(String key, String value, long ttlSeconds) {
        if (redisAvailable) {
            try {
                redisTemplate.opsForValue().set(key, value, Duration.ofSeconds(ttlSeconds));

                return;
            } catch (Exception exception) {
                log.warn("Redis setex failed for key {}: {}", key, exception.getMessage());
            }
        }

        long expiresAt = System.currentTimeMillis() + (ttlSeconds * 1000);
        inMemoryCache.put(key, new CacheEntry(value, expiresAt));
    }

    public <T> void setWithExpiry(String key, T value, long ttlSeconds) {
        try {
            String serialized = objectMapper.writeValueAsString(value);
            setWithExpiry(key, serialized, ttlSeconds);
        } catch (JsonProcessingException exception) {
            log.error("Failed to serialize value for key {}: {}", key, exception.getMessage());
        }
    }

    public boolean setIfAbsent(String key, String value, long ttlSeconds) {
        if (redisAvailable) {
            try {
                Boolean result = redisTemplate.opsForValue()
                        .setIfAbsent(key, value, Duration.ofSeconds(ttlSeconds));

                return Boolean.TRUE.equals(result);
            } catch (Exception exception) {
                log.warn("Redis setnx failed for key {}: {}", key, exception.getMessage());
            }
        }

        CacheEntry existing = inMemoryCache.get(key);
        if (existing != null && !existing.isExpired()) {
            return false;
        }

        long expiresAt = System.currentTimeMillis() + (ttlSeconds * 1000);
        inMemoryCache.put(key, new CacheEntry(value, expiresAt));

        return true;
    }

    public void delete(String key) {
        if (redisAvailable) {
            try {
                redisTemplate.delete(key);

                return;
            } catch (Exception exception) {
                log.warn("Redis delete failed for key {}: {}", key, exception.getMessage());
            }
        }

        inMemoryCache.remove(key);
    }

    private record CacheEntry(String value, Long expiresAt) {

        public String getValue() {
            return value;
        }

        public boolean isExpired() {
            return expiresAt != null && System.currentTimeMillis() > expiresAt;
        }
    }

}
