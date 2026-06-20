package com.smartlaundromat.machine.model;

import com.smartlaundromat.machine.model.enums.CommProtocol;
import com.smartlaundromat.machine.model.enums.CycleType;
import com.smartlaundromat.machine.model.enums.MachineStatus;
import com.smartlaundromat.machine.model.enums.MachineType;
import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "machines")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Machine {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "machine_id", unique = true, nullable = false, length = 30)
    private String machineId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private MachineType type;

    @Column(length = 50)
    @Builder.Default
    private String brand = "LG";

    @Column(length = 50)
    @Builder.Default
    private String model = "Commercial Pro";

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    @Builder.Default
    private MachineStatus status = MachineStatus.IDLE;

    /** Remote-control transport used to start/stop this machine (EQLink, Modbus RTU, or MQTT). */
    @Enumerated(EnumType.STRING)
    @Column(name = "comm_protocol", nullable = false, length = 10)
    @Builder.Default
    private CommProtocol commProtocol = CommProtocol.MQTT;

    @Column(name = "is_online", nullable = false)
    @Builder.Default
    private Boolean isOnline = true;

    @Column(name = "last_heartbeat")
    @Builder.Default
    private LocalDateTime lastHeartbeat = LocalDateTime.now();

    // Current cycle info
    @Enumerated(EnumType.STRING)
    @Column(name = "current_cycle_type", length = 20)
    @Builder.Default
    private CycleType currentCycleType = CycleType.NONE;

    @Column(name = "cycle_started_at")
    private LocalDateTime cycleStartedAt;

    @Column(name = "cycle_duration_minutes")
    private Integer cycleDurationMinutes;

    @Column(name = "cycle_ends_at")
    private LocalDateTime cycleEndsAt;

    @Column(name = "cycle_progress")
    @Builder.Default
    private Integer cycleProgress = 0;

    // Telemetry
    @Column(precision = 5)
    private Double temperature;

    @Column(precision = 5)
    private Double humidity;

    @Column(name = "water_level", precision = 5)
    private Double waterLevel;

    @Column(name = "spin_speed")
    private Integer spinSpeed;

    @Column(precision = 5)
    private Double vibration;

    @Column(name = "door_locked")
    @Builder.Default
    private Boolean doorLocked = false;

    @Column(name = "power_consumption")
    private Double powerConsumption;

    // Error tracking
    @Column(name = "error_code", length = 20)
    private String errorCode;

    @Column(name = "error_message", length = 200)
    private String errorMessage;

    // Maintenance
    @Column(name = "total_cycles")
    @Builder.Default
    private Integer totalCycles = 0;

    @Column(name = "cycles_since_service")
    @Builder.Default
    private Integer cyclesSinceService = 0;

    @Column(name = "last_service_date")
    private LocalDateTime lastServiceDate;

    // Location
    @Column(length = 30)
    @Builder.Default
    private String zone = "main";

    @Column
    @Builder.Default
    private Integer position = 1;

    @Column(name = "created_at", nullable = false, updatable = false)
    @Builder.Default
    private LocalDateTime createdAt = LocalDateTime.now();

    @Column(name = "updated_at")
    @Builder.Default
    private LocalDateTime updatedAt = LocalDateTime.now();

    @PreUpdate
    protected void onUpdate() {
        this.updatedAt = LocalDateTime.now();
    }

    public boolean isAvailable() {
        return this.status == MachineStatus.IDLE && this.isOnline && !this.doorLocked;
    }

    public String getDisplayName() {
        String typeLabel = this.type == MachineType.WASHER ? "Washer" : "Dryer";
        String number = this.machineId.replaceAll("\\D+", "");
        return typeLabel + " " + number;
    }
}
