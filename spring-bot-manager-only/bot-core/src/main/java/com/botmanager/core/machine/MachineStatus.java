package com.botmanager.core.machine;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;
import lombok.Getter;

@Getter
public enum MachineStatus {

    AVAILABLE("AVAILABLE"),
    IN_USE("IN_USE"),
    COMPLETING("COMPLETING"),
    ERROR("ERROR"),
    MAINTENANCE("MAINTENANCE"),
    OFFLINE("OFFLINE");

    private final String value;

    MachineStatus(String value) {
        this.value = value;
    }

    @JsonValue
    public String getValue() {
        return value;
    }

    @JsonCreator
    public static MachineStatus fromValue(String value) {
        if (value == null) {
            return OFFLINE;
        }

        for (MachineStatus status : values()) {
            if (status.value.equalsIgnoreCase(value)) {
                return status;
            }
        }

        return OFFLINE;
    }

}
