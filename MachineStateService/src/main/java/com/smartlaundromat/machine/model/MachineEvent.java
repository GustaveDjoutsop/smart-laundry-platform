package com.smartlaundromat.machine.model;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "machine_events")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class MachineEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "machine_id", nullable = false, length = 30)
    private String machineId;

    @Column(name = "event_type", nullable = false, length = 50)
    private String eventType;

    @Column(name = "previous_status", length = 20)
    private String previousStatus;

    @Column(name = "new_status", length = 20)
    private String newStatus;

    @Column(length = 500)
    private String details;

    @Column(name = "rfid_card_uid", length = 50)
    private String rfidCardUid;

    @Column(name = "transaction_reference", length = 50)
    private String transactionReference;

    @Column(name = "created_at", nullable = false, updatable = false)
    @Builder.Default
    private LocalDateTime createdAt = LocalDateTime.now();
}
