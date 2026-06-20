package com.smartlaundromat.machine.model;

import com.smartlaundromat.machine.model.enums.CycleStatus;
import com.smartlaundromat.machine.model.enums.CycleType;
import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "machine_cycles")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class MachineCycle {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "machine_id", nullable = false, length = 30)
    private String machineId;

    @Enumerated(EnumType.STRING)
    @Column(name = "cycle_type", nullable = false, length = 20)
    private CycleType cycleType;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    @Builder.Default
    private CycleStatus status = CycleStatus.NOT_STARTED;

    @Column(name = "duration_minutes", nullable = false)
    private Integer durationMinutes;

    @Column(name = "started_at")
    private LocalDateTime startedAt;

    @Column(name = "ends_at")
    private LocalDateTime endsAt;

    @Column(name = "completed_at")
    private LocalDateTime completedAt;

    @Column(name = "rfid_card_uid", length = 50)
    private String rfidCardUid;

    @Column(name = "transaction_reference", length = 50)
    private String transactionReference;

    @Column(name = "pulse_count")
    private Integer pulseCount;

    @Column(name = "created_at", nullable = false, updatable = false)
    @Builder.Default
    private LocalDateTime createdAt = LocalDateTime.now();
}
