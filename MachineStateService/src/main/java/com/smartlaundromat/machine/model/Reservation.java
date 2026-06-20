package com.smartlaundromat.machine.model;

import com.smartlaundromat.machine.model.enums.ReservationStatus;
import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

/**
 * A 1-hour reservation of a machine for a specific time slot.
 *
 * <h2>Redemption is by CODE + MACHINE, never by user</h2>
 * The {@link #reservationCode} is delivered to the customer's WhatsApp. To run the machine
 * the customer sends that code back when selecting the machine. The backend cross-checks the
 * code against {@link #machineId} only — <strong>not</strong> against the phone number — because
 * a customer may reserve on behalf of someone else.
 */
@Entity
@Table(
    name = "reservations",
    indexes = {
        @Index(name = "idx_res_code_machine", columnList = "reservation_code,machine_id"),
        @Index(name = "idx_res_machine_status", columnList = "machine_id,status")
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Reservation {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** Unique human-friendly code delivered to WhatsApp (e.g. {@code RES-AB12CD}). */
    @Column(name = "reservation_code", unique = true, nullable = false, length = 20)
    private String reservationCode;

    @Column(name = "machine_id", nullable = false, length = 30)
    private String machineId;

    /** Phone of whoever made the reservation — informational only, never used to authorize. */
    @Column(name = "customer_phone", length = 30)
    private String customerPhone;

    @Column(name = "slot_start", nullable = false)
    private LocalDateTime slotStart;

    /** Always {@code slotStart + 1 hour}. */
    @Column(name = "slot_end", nullable = false)
    private LocalDateTime slotEnd;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    @Builder.Default
    private ReservationStatus status = ReservationStatus.PENDING_PAYMENT;

    /** Reservation fee = price of the highest washing cycle. */
    @Column(name = "fee_amount", nullable = false)
    private Integer feeAmount;

    @Column(length = 10)
    @Builder.Default
    private String currency = "XAF";

    /** Payment reference for the reservation-fee payment; used to activate on confirmation. */
    @Column(name = "transaction_reference", length = 80)
    private String transactionReference;

    @Column(name = "created_at", nullable = false, updatable = false)
    @Builder.Default
    private LocalDateTime createdAt = LocalDateTime.now();

    @Column(name = "activated_at")
    private LocalDateTime activatedAt;

    @Column(name = "used_at")
    private LocalDateTime usedAt;

    /** {@code true} when {@code now} falls within the reserved slot. */
    public boolean coversNow() {
        LocalDateTime now = LocalDateTime.now();
        return !now.isBefore(slotStart) && now.isBefore(slotEnd);
    }

    public boolean isActive() {
        return status == ReservationStatus.ACTIVE;
    }
}
