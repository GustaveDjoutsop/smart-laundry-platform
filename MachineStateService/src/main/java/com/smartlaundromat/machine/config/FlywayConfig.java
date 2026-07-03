package com.smartlaundromat.machine.config;

import lombok.extern.slf4j.Slf4j;
import org.flywaydb.core.Flyway;
import org.springframework.boot.autoconfigure.flyway.FlywayConfigurationCustomizer;
import org.springframework.boot.autoconfigure.flyway.FlywayMigrationStrategy;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.Map;

/**
 * Flyway hardening for running against the Supabase transaction-mode pooler (port 6543).
 *
 * <p>Two independent problems are addressed:
 *
 * <ol>
 *   <li><b>Advisory lock on a transaction pooler.</b> Flyway takes a session-scoped
 *       PostgreSQL advisory lock around migrate/repair. The transaction-mode pooler recycles
 *       the backend connection between statements, so the lock is lost before Flyway releases
 *       it and startup can fail or hang. Disabling {@code flyway.postgresql.transactionalLock}
 *       is the same fix already applied in spring-bot-manager, which shares this pooler.</li>
 *
 *   <li><b>Checksum mismatch on an already-applied migration.</b> Editing a migration file after
 *       it has been applied (e.g. adding {@code IF NOT EXISTS} to V2) changes its checksum, so
 *       {@code validate-on-migrate} aborts the whole service on the next boot — a multi-hour
 *       outage. Running {@code repair()} before {@code migrate()} realigns the schema-history
 *       checksums with the current files so the service boots instead of crashing.</li>
 * </ol>
 *
 * <p>Trade-off: repair also silently accepts a migration edit that does NOT match what was
 * applied to the database. That is acceptable here — migrations are append-only by convention
 * and schema drift is still caught by {@code hibernate.ddl-auto=validate} at startup — but any
 * intentional schema change must be a NEW migration, never an edit to an applied one.
 */
@Slf4j
@Configuration
public class FlywayConfig {

    /**
     * Disable Flyway's PostgreSQL advisory lock — required behind the Supabase
     * transaction-mode pooler (port 6543). Uses the property-map API because Flyway 10
     * removed {@code postgresqlTransactionalLock(boolean)} from FluentConfiguration.
     */
    @Bean
    public FlywayConfigurationCustomizer flywayNoAdvisoryLock() {
        return configuration -> configuration.configuration(
                Map.of("flyway.postgresql.transactionalLock", "false")
        );
    }

    /** Run {@code repair} before every {@code migrate} so benign checksum mismatches self-heal. */
    @Bean
    public FlywayMigrationStrategy repairThenMigrate() {
        return flyway -> {
            repairQuietly(flyway);
            flyway.migrate();
        };
    }

    private void repairQuietly(Flyway flyway) {
        try {
            flyway.repair();
        } catch (Exception exception) {
            // Never let a repair failure block startup — migrate() will surface any real problem.
            log.warn("Flyway repair failed (continuing to migrate): {}", exception.getMessage());
        }
    }
}
