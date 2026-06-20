package com.smartlaundromat.machine.dto;

import com.smartlaundromat.machine.model.Reservation;
import com.smartlaundromat.machine.model.enums.ReservationStatus;
import lombok.Builder;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * Reservation details returned to the caller. The {@code reservationCode} is what the bot
 * forwards to the customer's WhatsApp; the customer sends it back to run the machine.
 */
@Data
@Builder
public class ReservationResponse {

    private String reservationCode;
    private String machineId;
    private String machineName;
    private String customerPhone;
    private LocalDateTime slotStart;
    private LocalDateTime slotEnd;
    private ReservationStatus status;
    private Integer feeAmount;
    private String currency;
    private String transactionReference;
    private String message;

    public static ReservationResponse from(Reservation r, String machineName, String message) {
        return ReservationResponse.builder()
                .reservationCode(r.getReservationCode())
                .machineId(r.getMachineId())
                .machineName(machineName)
                .customerPhone(r.getCustomerPhone())
                .slotStart(r.getSlotStart())
                .slotEnd(r.getSlotEnd())
                .status(r.getStatus())
                .feeAmount(r.getFeeAmount())
                .currency(r.getCurrency())
                .transactionReference(r.getTransactionReference())
                .message(message)
                .build();
    }
}
