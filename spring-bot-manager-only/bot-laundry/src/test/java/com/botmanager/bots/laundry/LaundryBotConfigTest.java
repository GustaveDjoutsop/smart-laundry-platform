package com.botmanager.bots.laundry;

import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class LaundryBotConfigTest {

    @Test
    void shouldHaveDefaultCycleValues() {
        // given / when
        LaundryBotConfig config = new LaundryBotConfig();

        // then
        assertThat(config.getShortCycle().getDuration()).isEqualTo(30);
        assertThat(config.getShortCycle().getPrice()).isEqualTo(1000);
        assertThat(config.getShortCycle().getPulseCount()).isEqualTo(1);
        assertThat(config.getLongCycle().getDuration()).isEqualTo(60);
        assertThat(config.getLongCycle().getPrice()).isEqualTo(2000);
        assertThat(config.getLongCycle().getPulseCount()).isEqualTo(2);
    }

    @Test
    void shouldHaveDefaultBusinessHours() {
        // given / when
        LaundryBotConfig config = new LaundryBotConfig();

        // then
        assertThat(config.getBusinessHours().getOpenTime()).isEqualTo("07:00");
        assertThat(config.getBusinessHours().getCloseTime()).isEqualTo("22:00");
        assertThat(config.getBusinessHours().getClosingBufferMinutes()).isEqualTo(15);
        assertThat(config.getBusinessHours().getTimezone()).isEqualTo("Africa/Douala");
    }

    @Nested
    class FeaturesConfig {

        @Test
        void shouldDefaultBothFeaturesToFalse() {
            // given / when
            LaundryBotConfig.FeaturesConfig features = new LaundryBotConfig.FeaturesConfig();

            // then
            assertThat(features.isWashFlowEnabled()).isFalse();
            assertThat(features.isReservationEnabled()).isFalse();
        }

        @Test
        void shouldAllowSettingFeatures() {
            // given
            LaundryBotConfig.FeaturesConfig features = new LaundryBotConfig.FeaturesConfig();

            // when
            features.setWashFlowEnabled(true);
            features.setReservationEnabled(true);

            // then
            assertThat(features.isWashFlowEnabled()).isTrue();
            assertThat(features.isReservationEnabled()).isTrue();
        }
    }

    @Nested
    class ReservationConfig {

        @Test
        void shouldHaveDefaultValues() {
            // given / when
            LaundryBotConfig.ReservationConfig reservation = new LaundryBotConfig.ReservationConfig();

            // then
            assertThat(reservation.getPrice()).isEqualTo(500);
            assertThat(reservation.getDurationMinutes()).isEqualTo(60);
        }

        @Test
        void shouldAllowSettingValues() {
            // given
            LaundryBotConfig.ReservationConfig reservation = new LaundryBotConfig.ReservationConfig();

            // when
            reservation.setPrice(750);
            reservation.setDurationMinutes(90);

            // then
            assertThat(reservation.getPrice()).isEqualTo(750);
            assertThat(reservation.getDurationMinutes()).isEqualTo(90);
        }
    }

    @Nested
    class BusinessHoursConfig {

        @Test
        void shouldAllowCustomValues() {
            // given
            LaundryBotConfig.BusinessHoursConfig hours = new LaundryBotConfig.BusinessHoursConfig();

            // when
            hours.setOpenTime("08:00");
            hours.setCloseTime("20:00");
            hours.setClosingBufferMinutes(30);
            hours.setTimezone("Europe/Berlin");

            // then
            assertThat(hours.getOpenTime()).isEqualTo("08:00");
            assertThat(hours.getCloseTime()).isEqualTo("20:00");
            assertThat(hours.getClosingBufferMinutes()).isEqualTo(30);
            assertThat(hours.getTimezone()).isEqualTo("Europe/Berlin");
        }
    }

    @Nested
    class MqttConfig {

        @Test
        void shouldSetAndGetTopicPrefix() {
            // given
            LaundryBotConfig.MqttConfig mqtt = new LaundryBotConfig.MqttConfig();

            // when
            mqtt.setTopicPrefix("laundry/machines");

            // then
            assertThat(mqtt.getTopicPrefix()).isEqualTo("laundry/machines");
        }
    }

    @Test
    void shouldSetAndGetAllFields() {
        // given
        LaundryBotConfig config = new LaundryBotConfig();

        // when
        config.setBotId("my-bot");
        config.setStaffAlertPhone("+237600000000");

        // then
        assertThat(config.getBotId()).isEqualTo("my-bot");
        assertThat(config.getStaffAlertPhone()).isEqualTo("+237600000000");
    }
}
