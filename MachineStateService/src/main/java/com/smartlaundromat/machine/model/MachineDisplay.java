package com.smartlaundromat.machine.model;

import com.smartlaundromat.machine.model.enums.MachineStatus;
import com.smartlaundromat.machine.model.enums.MachineType;
import lombok.AccessLevel;
import lombok.NoArgsConstructor;

import java.util.regex.Pattern;

/**
 * Presentation rules shared by the {@link Machine} entity and the lightweight
 * {@link com.smartlaundromat.machine.repository.projection.MachineStatusRow} projection, so
 * availability and display-name logic has exactly one implementation no matter which of the two
 * a caller loaded.
 */
@NoArgsConstructor(access = AccessLevel.PRIVATE)
public final class MachineDisplay {

    private static final String WASHER_LABEL = "Washer";
    private static final String DRYER_LABEL = "Dryer";

    /** Precompiled: this runs once per machine on every status poll. */
    private static final Pattern NON_DIGITS = Pattern.compile("\\D+");

    /**
     * A machine is bookable only when it is idle, reporting online, and its door is known to be
     * unlocked. Both {@code Boolean} columns are null-safe, and both fail closed: {@code door_locked}
     * is nullable in the schema, and an unknown door state must not make a machine bookable.
     */
    public static boolean isAvailable(MachineStatus status, Boolean isOnline, Boolean doorLocked) {
        return status == MachineStatus.IDLE
                && Boolean.TRUE.equals(isOnline)
                && Boolean.FALSE.equals(doorLocked);
    }

    public static String displayName(MachineType type, String machineId) {
        String typeLabel = type == MachineType.WASHER ? WASHER_LABEL : DRYER_LABEL;

        return typeLabel + " " + NON_DIGITS.matcher(machineId).replaceAll("");
    }
}
