package com.botmanager.core.flow;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;
import lombok.Getter;

@Getter
public enum StateType {

    MESSAGE("message"),
    INPUT("input"),
    BUTTONS("buttons"),
    ACTION("action");

    private final String value;

    StateType(String value) {
        this.value = value;
    }

    @JsonValue
    public String getValue() {
        return value;
    }

    @JsonCreator
    public static StateType fromValue(String value) {
        if (value == null) {
            return null;
        }

        for (StateType type : values()) {
            if (type.value.equalsIgnoreCase(value)) {
                return type;
            }
        }

        return null;
    }

}
