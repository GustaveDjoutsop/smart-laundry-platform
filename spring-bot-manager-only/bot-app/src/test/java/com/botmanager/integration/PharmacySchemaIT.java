package com.botmanager.integration;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
class PharmacySchemaIT extends BaseIntegrationTest {

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void flywayMigrationCreatesPharmacyTables() {
        var tables = jdbcTemplate.queryForList(
                "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
                String.class
        );

        assertThat(tables).contains("pharmacy_products", "pharmacy_reservations");
    }

    @Test
    void flywayMigrationCreatesPharmacyIndexes() {
        var indexes = jdbcTemplate.queryForList(
                "SELECT indexname FROM pg_indexes WHERE schemaname = 'public'",
                String.class
        );

        assertThat(indexes).contains(
                "idx_pharmacy_products_name",
                "idx_pharmacy_products_category",
                "idx_pharmacy_products_active",
                "idx_pharmacy_reservations_phone",
                "idx_pharmacy_reservations_product"
        );
    }

    @Test
    void canInsertAndQueryPharmacyProduct() {
        jdbcTemplate.update(
                "INSERT INTO pharmacy_products (name, price, stock, category) VALUES (?, ?, ?, ?)",
                "Paracetamol 500mg", 500.00, 100, "Pain Relief"
        );

        var count = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM pharmacy_products WHERE name = ?",
                Integer.class, "Paracetamol 500mg"
        );

        assertThat(count).isEqualTo(1);
    }

    @Test
    void canInsertReservationWithProductReference() {
        jdbcTemplate.update(
                "INSERT INTO pharmacy_products (id, name, price, stock) VALUES (gen_random_uuid(), 'Test Product', 1000.00, 50)"
        );

        var productId = jdbcTemplate.queryForObject(
                "SELECT id FROM pharmacy_products WHERE name = 'Test Product' LIMIT 1",
                java.util.UUID.class
        );

        jdbcTemplate.update(
                "INSERT INTO pharmacy_reservations (product_id, customer_phone, quantity, status) VALUES (?, ?, ?, ?)",
                productId, "237600000001", 2, "PENDING"
        );

        var count = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM pharmacy_reservations WHERE customer_phone = ?",
                Integer.class, "237600000001"
        );

        assertThat(count).isEqualTo(1);
    }

}
