package com.botmanager.bots.laundry;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class CycleConfigTest {

    @Test
    void shouldCreateWithDefaultConstructor() {
        // given / when
        CycleConfig config = new CycleConfig();

        // then
        assertThat(config.getDuration()).isZero();
        assertThat(config.getPrice()).isZero();
        assertThat(config.getPulseCount()).isZero();
        assertThat(config.getCurrency()).isEqualTo("XAF");
    }

    @Test
    void shouldCreateWithParameterizedConstructor() {
        // given / when
        CycleConfig config = new CycleConfig(45, 1500, 3);

        // then
        assertThat(config.getDuration()).isEqualTo(45);
        assertThat(config.getPrice()).isEqualTo(1500);
        assertThat(config.getPulseCount()).isEqualTo(3);
    }

    @Test
    void shouldSetAndGetAllFields() {
        // given
        CycleConfig config = new CycleConfig();

        // when
        config.setDuration(90);
        config.setPrice(3000);
        config.setPulseCount(4);
        config.setCurrency("EUR");

        // then
        assertThat(config.getDuration()).isEqualTo(90);
        assertThat(config.getPrice()).isEqualTo(3000);
        assertThat(config.getPulseCount()).isEqualTo(4);
        assertThat(config.getCurrency()).isEqualTo("EUR");
    }
}
