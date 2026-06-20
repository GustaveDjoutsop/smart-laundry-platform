package com.botmanager.core.machine;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import static org.assertj.core.api.Assertions.assertThat;

class MachineStatusTest {

    @ParameterizedTest
    @CsvSource({
            "AVAILABLE, AVAILABLE",
            "available, AVAILABLE",
            "IN_USE, IN_USE",
            "in_use, IN_USE",
            "COMPLETING, COMPLETING",
            "completing, COMPLETING",
            "ERROR, ERROR",
            "error, ERROR",
            "MAINTENANCE, MAINTENANCE",
            "maintenance, MAINTENANCE"
    })
    void shouldParseFromValueCaseInsensitively(String input, String expectedName) {
        // when
        MachineStatus result = MachineStatus.fromValue(input);

        // then
        assertThat(result).isEqualTo(MachineStatus.valueOf(expectedName));
    }

    @Test
    void shouldReturnAvailableForNullValue() {
        // when
        MachineStatus result = MachineStatus.fromValue(null);

        // then
        assertThat(result).isEqualTo(MachineStatus.AVAILABLE);
    }

    @Test
    void shouldReturnAvailableForUnknownValue() {
        // when
        MachineStatus result = MachineStatus.fromValue("UNKNOWN");

        // then
        assertThat(result).isEqualTo(MachineStatus.AVAILABLE);
    }

    @Test
    void shouldReturnCorrectJsonValues() {
        // then
        assertThat(MachineStatus.AVAILABLE.getValue()).isEqualTo("AVAILABLE");
        assertThat(MachineStatus.IN_USE.getValue()).isEqualTo("IN_USE");
        assertThat(MachineStatus.COMPLETING.getValue()).isEqualTo("COMPLETING");
        assertThat(MachineStatus.ERROR.getValue()).isEqualTo("ERROR");
        assertThat(MachineStatus.MAINTENANCE.getValue()).isEqualTo("MAINTENANCE");
    }

}
