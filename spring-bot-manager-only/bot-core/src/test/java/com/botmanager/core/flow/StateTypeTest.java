package com.botmanager.core.flow;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import static org.assertj.core.api.Assertions.assertThat;

class StateTypeTest {

    @ParameterizedTest
    @CsvSource({
            "message, MESSAGE",
            "MESSAGE, MESSAGE",
            "Message, MESSAGE",
            "input, INPUT",
            "INPUT, INPUT",
            "buttons, BUTTONS",
            "BUTTONS, BUTTONS",
            "action, ACTION",
            "ACTION, ACTION"
    })
    void shouldParseFromValueCaseInsensitively(String input, String expectedName) {
        // when
        StateType result = StateType.fromValue(input);

        // then
        assertThat(result).isEqualTo(StateType.valueOf(expectedName));
    }

    @Test
    void shouldReturnNullForNullValue() {
        // when
        StateType result = StateType.fromValue(null);

        // then
        assertThat(result).isNull();
    }

    @Test
    void shouldReturnNullForUnknownValue() {
        // when
        StateType result = StateType.fromValue("nonexistent");

        // then
        assertThat(result).isNull();
    }

    @Test
    void shouldReturnCorrectJsonValue() {
        // then
        assertThat(StateType.MESSAGE.getValue()).isEqualTo("message");
        assertThat(StateType.INPUT.getValue()).isEqualTo("input");
        assertThat(StateType.BUTTONS.getValue()).isEqualTo("buttons");
        assertThat(StateType.ACTION.getValue()).isEqualTo("action");
    }

}
