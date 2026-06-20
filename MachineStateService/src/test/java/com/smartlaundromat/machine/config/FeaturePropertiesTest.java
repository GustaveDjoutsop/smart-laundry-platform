package com.smartlaundromat.machine.config;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class FeaturePropertiesTest {

    @Test
    void shouldDefaultToDisabled() {
        // given
        FeatureProperties props = new FeatureProperties();

        // when / then
        assertThat(props.isReservationEnabled()).isFalse();
    }

    @Test
    void shouldAllowEnabling() {
        // given
        FeatureProperties props = new FeatureProperties();

        // when
        props.setReservationEnabled(true);

        // then
        assertThat(props.isReservationEnabled()).isTrue();
    }
}
