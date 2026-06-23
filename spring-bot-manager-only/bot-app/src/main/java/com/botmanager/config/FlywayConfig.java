package com.botmanager.config;

import org.flywaydb.core.api.configuration.FluentConfiguration;
import org.springframework.boot.autoconfigure.flyway.FlywayConfigurationCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.Map;

@Configuration
public class FlywayConfig {

    /**
     * Disables Flyway's PostgreSQL advisory lock mechanism via the property map API
     * (Flyway 10 removed postgresqlTransactionalLock() from FluentConfiguration).
     * Required when connecting via Supabase transaction-mode pooler (port 6543):
     * advisory locks are session-scoped and the pooler recycles the connection
     * between acquire and release, causing Flyway startup to fail.
     */
    @Bean
    public FlywayConfigurationCustomizer flywayNoAdvisoryLock() {
        return configuration -> configuration.configuration(
                Map.of("flyway.postgresql.transactionalLock", "false")
        );
    }
}
