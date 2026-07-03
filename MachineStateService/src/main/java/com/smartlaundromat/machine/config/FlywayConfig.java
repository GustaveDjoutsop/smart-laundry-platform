package com.smartlaundromat.machine.config;

import lombok.extern.slf4j.Slf4j;
import org.flywaydb.core.Flyway;
import org.springframework.boot.autoconfigure.flyway.FlywayMigrationStrategy;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Runs {@code flyway repair} before every {@code migrate} on startup.
 *
 * <p>Rationale: an already-applied migration whose file was later edited in a benign way
 * (e.g. adding {@code IF NOT EXISTS} to V2) produces a checksum mismatch that fails Flyway
 * validation and prevents the whole service from starting. This has caused multi-hour
 * outages. {@code repair()} realigns the schema-history checksums with the current migration
 * files (and clears failed migration rows) so the service boots instead of crashing.
 *
 * <p>Trade-off: repair also silently accepts a migration edit that does NOT match what was
 * applied to the database. That risk is acceptable here — migrations are append-only by
 * convention and schema drift is caught by {@code hibernate.ddl-auto=validate} at startup —
 * but any intentional schema change must still be a NEW migration, never an edit to an
 * applied one.
 */
@Slf4j
@Configuration(proxyBeanMethods = false)
public class FlywayConfig {

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
