package com.botmanager.bots.laundry;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class LaundryBotPropertiesTest {

    @Test
    void shouldHaveDefaultFeaturesOverride() {
        // given / when
        LaundryBotProperties props = new LaundryBotProperties();

        // then
        assertThat(props.getFeatures()).isNotNull();
        assertThat(props.getFeatures().getWashFlowEnabled()).isNull();
        assertThat(props.getFeatures().getReservationEnabled()).isNull();
    }

    @Test
    void shouldSetAndGetFeaturesOverride() {
        // given
        LaundryBotProperties props = new LaundryBotProperties();

        // when
        props.getFeatures().setWashFlowEnabled(true);
        props.getFeatures().setReservationEnabled(false);

        // then
        assertThat(props.getFeatures().getWashFlowEnabled()).isTrue();
        assertThat(props.getFeatures().getReservationEnabled()).isFalse();
    }
}
