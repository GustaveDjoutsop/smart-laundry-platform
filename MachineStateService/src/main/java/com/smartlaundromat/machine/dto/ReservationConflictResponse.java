package com.smartlaundromat.machine.dto;

import com.smartlaundromat.machine.model.Reservation;
import lombok.Builder;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.Optional;

/** Result of a duration-aware overlap check against a machine's upcoming reservations. */
@Data
@Builder
public class ReservationConflictResponse {

    private boolean conflict;
    private String conflictingReservationCode;
    private LocalDateTime conflictingSlotStart;
    private LocalDateTime conflictingSlotEnd;

    public static ReservationConflictResponse from(Optional<Reservation> conflicting) {
        return conflicting
                .map(r -> ReservationConflictResponse.builder()
                        .conflict(true)
                        .conflictingReservationCode(r.getReservationCode())
                        .conflictingSlotStart(r.getSlotStart())
                        .conflictingSlotEnd(r.getSlotEnd())
                        .build())
                .orElse(ReservationConflictResponse.builder().conflict(false).build());
    }
}
