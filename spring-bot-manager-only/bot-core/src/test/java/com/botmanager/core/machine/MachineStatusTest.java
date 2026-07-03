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
            "maintenance, MAINTENANCE",
            "OFFLINE, OFFLINE",
            "offline, OFFLINE"
    })
    void shouldParseFromValueCaseInsensitively(String input, String expectedName) {
        // when
        MachineStatus result = MachineStatus.fromValue(input);

        // then
        assertThat(result).isEqualTo(MachineStatus.valueOf(expectedName));
    }

    @Test
    void shouldReturnOfflineForNullValue() {
        // Null/unknown status is treated as OFFLINE (unavailable), not AVAILABLE.
        MachineStatus result = MachineStatus.fromValue(null);
        assertThat(result).isEqualTo(MachineStatus.OFFLINE);
    }

    @Test
    void shouldReturnOfflineForUnknownValue() {
        // Unknown status strings (e.g. future MSS statuses) default to OFFLINE, not AVAILABLE,
        // so they are never accidentally exposed as bookable machines.
        MachineStatus result = MachineStatus.fromValue("UNKNOWN");
        assertThat(result).isEqualTo(MachineStatus.OFFLINE);
    }

    @Test
    void shouldReturnCorrectJsonValues() {
        // then
        assertThat(MachineStatus.AVAILABLE.getValue()).isEqualTo("AVAILABLE");
        assertThat(MachineStatus.IN_USE.getValue()).isEqualTo("IN_USE");
        assertThat(MachineStatus.COMPLETING.getValue()).isEqualTo("COMPLETING");
        assertThat(MachineStatus.ERROR.getValue()).isEqualTo("ERROR");
        assertThat(MachineStatus.MAINTENANCE.getValue()).isEqualTo("MAINTENANCE");
        assertThat(MachineStatus.OFFLINE.getValue()).isEqualTo("OFFLINE");
    }

}
