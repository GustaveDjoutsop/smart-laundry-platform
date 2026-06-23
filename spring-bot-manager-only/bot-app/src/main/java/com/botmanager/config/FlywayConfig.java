package com.botmanager.config;

import org.flywaydb.core.api.configuration.FluentConfiguration;
import org.springframework.boot.autoconfigure.flyway.FlywayConfigurationCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class FlywayConfig {

    /**
     * Disables Flyway's PostgreSQL advisory lock mechanism.
     * Required when connecting via Supabase transaction-mode pooler (port 6543):
     * advisory locks are session-scoped but the pooler returns the connection to
     * the pool after each statement, so the lock is lost before Flyway releases it.
     */
    @Bean
    public FlywayConfigurationCustomizer flywayNoAdvisoryLock() {
        return configuration -> configuration.postgresqlTransactionalLock(false);
    }
}
