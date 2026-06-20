package com.botmanager.core.machine;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;
import lombok.Getter;

@Getter
public enum MachineType {

    WASHER("WASHER"),
    DRYER("DRYER");

    private final String value;

    MachineType(String value) {
        this.value = value;
    }

    @JsonValue
    public String getValue() {
        return value;
    }

    @JsonCreator
    public static MachineType fromValue(String value) {
        if (value == null) {
            return null;
        }

        for (MachineType type : values()) {
            if (type.value.equalsIgnoreCase(value)) {
                return type;
            }
        }

        return null;
    }

}
