package com.botmanager.integration;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
class FlywayMigrationIT extends BaseIntegrationTest {

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void flywayMigrationCreatesCoreTables() {
        var tables = jdbcTemplate.queryForList(
                "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
                String.class
        );

        assertThat(tables).contains("businesses", "messages", "payments");
    }

    @Test
    void flywayMigrationCreatesIndexes() {
        var indexes = jdbcTemplate.queryForList(
                "SELECT indexname FROM pg_indexes WHERE schemaname = 'public'",
                String.class
        );

        assertThat(indexes).contains("idx_messages_business", "idx_payments_status");
    }

    /**
     * Regression test for the DB/JSON flow-config drift class of bug (see V6, V7):
     * BotRegistry loads laundry_flow from this stored config, not configs/bots/laundry.bot.json,
     * so a state referenced by LaundryFlowPlugin but missing here resets the conversation to
     * language_selection instead of erroring loudly. Assert the states actually exist post-migration.
     */
    @Test
    void laundryFlowHasAllReservationAndRedemptionStates() {
        var stateKeys = jdbcTemplate.queryForList(
                "SELECT jsonb_object_keys(config->'flows'->'laundry_flow'->'states') " +
                        "FROM businesses WHERE bot_id = 'laundry'",
                String.class
        );

        assertThat(stateKeys).contains(
                "reservation_date", "await_reservation_date", "process_reservation_date",
                "reservation_time", "await_reservation_time", "process_reservation_time",
                "reservation_confirm", "await_reservation_confirm", "process_reservation_confirm",
                "initiate_reservation",
                "enter_reservation_code", "await_reservation_code", "process_reservation_code"
        );
    }

}
