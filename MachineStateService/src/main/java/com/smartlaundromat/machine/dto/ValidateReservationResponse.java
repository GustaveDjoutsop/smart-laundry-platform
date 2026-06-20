package com.smartlaundromat.machine.dto;

import com.smartlaundromat.machine.model.enums.ReservationStatus;
import lombok.Builder;
import lombok.Data;

/** Result of a code + machine reservation check. */
@Data
@Builder
public class ValidateReservationResponse {

    /** {@code true} when the code is valid for this machine and may run it now. */
    private boolean valid;

    /** Machine-readable reason when {@code valid=false} (e.g. NOT_FOUND, NOT_ACTIVE, OUT_OF_SLOT, USED). */
    private String reason;

    private String reservationCode;
    private String machineId;
    private ReservationStatus status;
}
