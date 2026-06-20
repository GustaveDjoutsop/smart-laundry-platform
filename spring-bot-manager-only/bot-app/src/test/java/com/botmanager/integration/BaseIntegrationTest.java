package com.botmanager.integration;

import com.botmanager.core.bot.BotRegistryRefreshEvent;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;

@ActiveProfiles("integration")
public abstract class BaseIntegrationTest {

    private static final PostgreSQLContainer<?> postgres =
            new PostgreSQLContainer<>("postgres:16-alpine")
                    .withDatabaseName("botmanager")
                    .withUsername("botmanager")
                    .withPassword("botmanager");

    private static final GenericContainer<?> redis =
            new GenericContainer<>("redis:7-alpine")
                    .withExposedPorts(6379);

    static {
        // Singleton container pattern: start once and let Testcontainers' Ryuk
        // reaper clean up at JVM exit. Per-class @Container lifecycle would stop
        // these after the first IT class's afterAll, leaving later classes'
        // cached Spring contexts pointed at a dead container port.
        postgres.start();
        redis.start();
    }

    @DynamicPropertySource
    static void registerDynamicProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        registry.add("spring.data.redis.host", redis::getHost);
        registry.add("spring.data.redis.port", () -> redis.getMappedPort(6379));
    }

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private ApplicationEventPublisher eventPublisher;

    @BeforeEach
    void resetDatabase() {
        jdbcTemplate.execute("TRUNCATE TABLE pharmacy_reservations, pharmacy_products, payments, messages, businesses RESTART IDENTITY CASCADE");
        new ResourceDatabasePopulator(new ClassPathResource("db/migration/V4__seed_existing_bots.sql"))
                .execute(jdbcTemplate.getDataSource());
        eventPublisher.publishEvent(new BotRegistryRefreshEvent(this));
    }

}
