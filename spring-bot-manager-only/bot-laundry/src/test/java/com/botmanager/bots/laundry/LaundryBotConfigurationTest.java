package com.botmanager.bots.laundry;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class LaundryBotConfigurationTest {

    @Test
    void shouldApplyWashFlowEnabledOverride() {
        // given
        LaundryBotConfig config = new LaundryBotConfig();
        config.getFeatures().setWashFlowEnabled(false);

        LaundryBotProperties props = new LaundryBotProperties();
        props.getFeatures().setWashFlowEnabled(true);

        // when
        LaundryBotConfiguration.applyYamlOverrides(config, props);

        // then
        assertThat(config.getFeatures().isWashFlowEnabled()).isTrue();
    }

    @Test
    void shouldApplyReservationEnabledOverride() {
        // given
        LaundryBotConfig config = new LaundryBotConfig();
        config.getFeatures().setReservationEnabled(false);

        LaundryBotProperties props = new LaundryBotProperties();
        props.getFeatures().setReservationEnabled(true);

        // when
        LaundryBotConfiguration.applyYamlOverrides(config, props);

        // then
        assertThat(config.getFeatures().isReservationEnabled()).isTrue();
    }

    @Test
    void shouldNotOverrideWhenPropsValueIsNull() {
        // given
        LaundryBotConfig config = new LaundryBotConfig();
        config.getFeatures().setWashFlowEnabled(true);
        config.getFeatures().setReservationEnabled(true);

        LaundryBotProperties props = new LaundryBotProperties();
        // Both override values are null by default

        // when
        LaundryBotConfiguration.applyYamlOverrides(config, props);

        // then
        assertThat(config.getFeatures().isWashFlowEnabled()).isTrue();
        assertThat(config.getFeatures().isReservationEnabled()).isTrue();
    }

    @Test
    void shouldHandleNullProps() {
        // given
        LaundryBotConfig config = new LaundryBotConfig();
        config.getFeatures().setWashFlowEnabled(true);

        // when
        LaundryBotConfiguration.applyYamlOverrides(config, null);

        // then
        assertThat(config.getFeatures().isWashFlowEnabled()).isTrue();
    }
}
