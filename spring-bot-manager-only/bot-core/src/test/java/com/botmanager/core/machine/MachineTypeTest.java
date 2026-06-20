package com.botmanager.core.machine;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import static org.assertj.core.api.Assertions.assertThat;

class MachineTypeTest {

    @ParameterizedTest
    @CsvSource({
            "WASHER, WASHER",
            "washer, WASHER",
            "Washer, WASHER",
            "DRYER, DRYER",
            "dryer, DRYER",
            "Dryer, DRYER"
    })
    void shouldParseFromValueCaseInsensitively(String input, String expectedName) {
        // when
        MachineType result = MachineType.fromValue(input);

        // then
        assertThat(result).isEqualTo(MachineType.valueOf(expectedName));
    }

    @Test
    void shouldReturnNullForNullValue() {
        // when
        MachineType result = MachineType.fromValue(null);

        // then
        assertThat(result).isNull();
    }

    @Test
    void shouldReturnNullForUnknownValue() {
        // when
        MachineType result = MachineType.fromValue("DISHWASHER");

        // then
        assertThat(result).isNull();
    }

    @Test
    void shouldReturnCorrectJsonValues() {
        // then
        assertThat(MachineType.WASHER.getValue()).isEqualTo("WASHER");
        assertThat(MachineType.DRYER.getValue()).isEqualTo("DRYER");
    }

}
