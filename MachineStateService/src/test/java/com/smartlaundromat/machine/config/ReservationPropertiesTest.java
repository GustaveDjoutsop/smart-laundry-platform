package com.smartlaundromat.machine.config;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class ReservationPropertiesTest {

    @Test
    void shouldHaveCorrectDefaults() {
        // given
        ReservationProperties props = new ReservationProperties();

        // when / then
        assertThat(props.getFeeAmount()).isEqualTo(1500);
        assertThat(props.getCurrency()).isEqualTo("XAF");
        assertThat(props.getCodeLength()).isEqualTo(6);
        assertThat(props.getCodePrefix()).isEqualTo("RES-");
    }

    @Test
    void shouldHaveFixedSlotMinutes() {
        // when / then
        assertThat(ReservationProperties.SLOT_MINUTES).isEqualTo(60);
    }

    @Test
    void shouldAcceptCustomValues() {
        // given
        ReservationProperties props = new ReservationProperties();

        // when
        props.setFeeAmount(2000);
        props.setCurrency("EUR");
        props.setCodeLength(8);
        props.setCodePrefix("BOOK-");

        // then
        assertThat(props.getFeeAmount()).isEqualTo(2000);
        assertThat(props.getCurrency()).isEqualTo("EUR");
        assertThat(props.getCodeLength()).isEqualTo(8);
        assertThat(props.getCodePrefix()).isEqualTo("BOOK-");
    }
}
