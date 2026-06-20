package com.botmanager.bots.laundry;

import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

class FeedbackRecordTest {

    @Test
    void shouldBuildWithAllFields() {
        // given
        Instant now = Instant.now();

        // when
        FeedbackRecord record = FeedbackRecord.builder()
                .id("fb-1")
                .botId("test-bot")
                .customerPhone("+237690000000")
                .machineId("w1")
                .machineName("Washer 1")
                .transactionId("txn-1")
                .rating(4)
                .comment("Good service")
                .submittedAt(now)
                .staffAlertSent(false)
                .build();

        // then
        assertThat(record.getId()).isEqualTo("fb-1");
        assertThat(record.getBotId()).isEqualTo("test-bot");
        assertThat(record.getCustomerPhone()).isEqualTo("+237690000000");
        assertThat(record.getMachineId()).isEqualTo("w1");
        assertThat(record.getMachineName()).isEqualTo("Washer 1");
        assertThat(record.getTransactionId()).isEqualTo("txn-1");
        assertThat(record.getRating()).isEqualTo(4);
        assertThat(record.getComment()).isEqualTo("Good service");
        assertThat(record.getSubmittedAt()).isEqualTo(now);
        assertThat(record.isStaffAlertSent()).isFalse();
    }

    @Test
    void shouldAllowSettingFields() {
        // given
        FeedbackRecord record = FeedbackRecord.builder().build();

        // when
        record.setComment("Updated comment");
        record.setStaffAlertSent(true);

        // then
        assertThat(record.getComment()).isEqualTo("Updated comment");
        assertThat(record.isStaffAlertSent()).isTrue();
    }
}
