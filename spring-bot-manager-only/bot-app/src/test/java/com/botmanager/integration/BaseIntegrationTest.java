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
        // V4 seeds the base laundry flow; V5-V7 patch its `businesses.config` with states
        // added after the seed (reservation, then redemption) via idempotent jsonb UPDATEs.
        // Replaying all of them keeps this reset in sync with what production's stored
        // flow actually contains post-migration, instead of silently reverting to V4's
        // stale subset every test run.
        for (String script : new String[]{
                "db/migration/V4__seed_existing_bots.sql",
                "db/migration/V5__add_laundry_reservation_date_time_states.sql",
                "db/migration/V6__add_laundry_full_reservation_states.sql",
                "db/migration/V7__add_laundry_redemption_states.sql"
        }) {
            new ResourceDatabasePopulator(new ClassPathResource(script))
                    .execute(jdbcTemplate.getDataSource());
        }
        eventPublisher.publishEvent(new BotRegistryRefreshEvent(this));
    }

}
