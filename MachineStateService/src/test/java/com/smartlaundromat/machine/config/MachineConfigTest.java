package com.smartlaundromat.machine.config;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class MachineConfigTest {

    @Test
    void shouldHaveDefaultHeartbeatTimeout() {
        // given
        MachineConfig config = new MachineConfig();

        // when / then
        assertThat(config.getHeartbeatTimeoutSeconds()).isEqualTo(120);
    }

    @Test
    void shouldHaveDefaultCycleCheckInterval() {
        // given
        MachineConfig config = new MachineConfig();

        // when / then
        assertThat(config.getCycleCheckIntervalMs()).isEqualTo(60000);
    }

    @Test
    void shouldAcceptCustomValues() {
        // given
        MachineConfig config = new MachineConfig();

        // when
        config.setHeartbeatTimeoutSeconds(300);
        config.setCycleCheckIntervalMs(30000);
        config.setAvailableIds(List.of("washer_01", "dryer_01"));

        // then
        assertThat(config.getHeartbeatTimeoutSeconds()).isEqualTo(300);
        assertThat(config.getCycleCheckIntervalMs()).isEqualTo(30000);
        assertThat(config.getAvailableIds()).containsExactly("washer_01", "dryer_01");
    }

    @Test
    void shouldHaveNullAvailableIdsByDefault() {
        // given
        MachineConfig config = new MachineConfig();

        // when / then
        assertThat(config.getAvailableIds()).isNull();
    }
}
