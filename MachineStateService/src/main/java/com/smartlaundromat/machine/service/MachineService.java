package com.smartlaundromat.machine.service;

import com.smartlaundromat.machine.config.MachineConfig;
import com.smartlaundromat.machine.dto.*;
import com.smartlaundromat.machine.eqlink.EqLinkProperties;
import com.smartlaundromat.machine.model.Reservation;
import com.smartlaundromat.machine.modbus.ModbusProperties;
import com.smartlaundromat.machine.simulator.MachineCommandDispatcher;

import com.smartlaundromat.machine.exception.MachineNotFoundException;
import com.smartlaundromat.machine.exception.MachineNotAvailableException;
import com.smartlaundromat.machine.model.Machine;
import com.smartlaundromat.machine.model.MachineCycle;
import com.smartlaundromat.machine.model.MachineEvent;
import com.smartlaundromat.machine.model.enums.*;
import com.smartlaundromat.machine.mqtt.MqttService;
import com.smartlaundromat.machine.repository.MachineCycleRepository;
import com.smartlaundromat.machine.repository.MachineEventRepository;
import com.smartlaundromat.machine.repository.MachineRepository;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;

/**
 * Core machine lifecycle service. Hardware start commands are routed through
 * {@link com.smartlaundromat.machine.simulator.MachineCommandDispatcher} — either the real
 * transport (EQLink / Modbus / MQTT) or the simulator no-op depending on the active profile.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class MachineService {

    private final MachineRepository machineRepository;
    private final MachineEventRepository machineEventRepository;
    private final MachineCycleRepository machineCycleRepository;
    private final MachineConfig machineConfig;
    private final MqttService mqttService;
    private final EqLinkProperties eqLinkProperties;
    private final ModbusProperties modbusProperties;

    /** Reservation gating — enforces that reserved machines need a valid code to start. */
    private final ReservationService reservationService;

    /** Routes the hardware start command to the real transport or the simulator no-op. */
    private final MachineCommandDispatcher commandDispatcher;

    private final MeterRegistry meterRegistry;

    @PostConstruct
    public void init() {
        mqttService.setMachineService(this);
        initializeMachines();
        log.info("EQLink integration {} — Modbus RTU integration {}",
                eqLinkProperties.isEnabled() ? "ENABLED" : "DISABLED",
                modbusProperties.isEnabled() ? "ENABLED" : "DISABLED");
    }

    // ── Machine initialization ────────────────────────────────────────────────

    private void initializeMachines() {
        for (String machineId : machineConfig.getAvailableIds()) {
            if (!machineRepository.existsByMachineId(machineId)) {
                MachineType type = machineId.startsWith("washer") ? MachineType.WASHER : MachineType.DRYER;
                int position = Integer.parseInt(machineId.replaceAll("\\D+", ""));

                Machine machine = Machine.builder()
                        .machineId(machineId)
                        .type(type)
                        .position(position)
                        .commProtocol(resolveProtocol(machineId))
                        .build();
                machineRepository.save(machine);
                log.info("Initialized machine: {} (protocol={})", machineId, machine.getCommProtocol());
            }
        }
    }

    /**
     * Decides which transport a machine uses, by precedence:
     * Modbus mapping → {@link CommProtocol#MODBUS}; EQLink mapping → {@link CommProtocol#EQLINK};
     * otherwise {@link CommProtocol#MQTT}.
     */
    private CommProtocol resolveProtocol(String machineId) {
        if (modbusProperties.getUnitIdMapping().containsKey(machineId)) {
            return CommProtocol.MODBUS;
        }
        if (eqLinkProperties.getDeviceNameMapping().containsKey(machineId)) {
            return CommProtocol.EQLINK;
        }
        return CommProtocol.MQTT;
    }

    // ── Telemetry ─────────────────────────────────────────────────────────────

    @Transactional
    public void processTelemetry(TelemetryPayload telemetry) {
        Machine machine = machineRepository.findByMachineId(telemetry.getMachineId())
                .orElse(null);

        if (machine == null) {
            log.warn("Unknown machine telemetry received: {}", telemetry.getMachineId());
            return;
        }

        String previousStatus = machine.getStatus().name();

        if (telemetry.getStatus() != null) {
            try {
                machine.setStatus(MachineStatus.valueOf(telemetry.getStatus().toUpperCase()));
            } catch (IllegalArgumentException ignored) { }
        }
        if (telemetry.getCycleType() != null) {
            try {
                machine.setCurrentCycleType(CycleType.valueOf(telemetry.getCycleType().toUpperCase()));
            } catch (IllegalArgumentException ignored) { }
        }
        if (telemetry.getCycleProgress() != null)    machine.setCycleProgress(telemetry.getCycleProgress());
        if (telemetry.getTemperature() != null)       machine.setTemperature(telemetry.getTemperature());
        if (telemetry.getHumidity() != null)          machine.setHumidity(telemetry.getHumidity());
        if (telemetry.getWaterLevel() != null)        machine.setWaterLevel(telemetry.getWaterLevel());
        if (telemetry.getSpinSpeed() != null)         machine.setSpinSpeed(telemetry.getSpinSpeed());
        if (telemetry.getVibration() != null)         machine.setVibration(telemetry.getVibration());
        if (telemetry.getDoorLocked() != null)        machine.setDoorLocked(telemetry.getDoorLocked());
        if (telemetry.getPowerConsumption() != null)  machine.setPowerConsumption(telemetry.getPowerConsumption());
        if (telemetry.getErrorCode() != null)         machine.setErrorCode(telemetry.getErrorCode());
        if (telemetry.getErrorMessage() != null)      machine.setErrorMessage(telemetry.getErrorMessage());
        if (telemetry.getTotalCycles() != null)       machine.setTotalCycles(telemetry.getTotalCycles());

        machine.setIsOnline(true);
        machine.setLastHeartbeat(LocalDateTime.now());
        machineRepository.save(machine);

        String newStatus = machine.getStatus().name();
        if (!previousStatus.equals(newStatus)) {
            recordEvent(machine.getMachineId(), "STATUS_CHANGE",
                    previousStatus, newStatus, "Telemetry update", null, null);
        }
    }

    // ── Cycle management ──────────────────────────────────────────────────────

    @Transactional
    public MachineCycle startCycle(StartCycleRequest request) {
        // Idempotency: the outbox relay may deliver the same PaymentSucceeded event
        // more than once. Return the existing cycle rather than double-starting.
        if (StringUtils.hasText(request.getTransactionReference())) {
            Optional<MachineCycle> existing =
                    machineCycleRepository.findByTransactionReference(request.getTransactionReference());
            if (existing.isPresent()) {
                log.info("Idempotent start — returning existing cycle for tx={}",
                        request.getTransactionReference());
                meterRegistry.counter("machine.cycle.idempotent.total",
                        "machine_id", request.getMachineId()).increment();
                return existing.get();
            }
        }

        // Locked fetch: holds the row for the rest of this transaction so the
        // active-cycle check below and the cycle/machine save are atomic against
        // a second concurrent startCycle call for the same machine.
        Machine machine = machineRepository.findByMachineIdForUpdate(request.getMachineId())
                .orElseThrow(() -> new MachineNotFoundException("Machine not found: " + request.getMachineId()));

        if (!machine.isAvailable()) {
            throw new MachineNotAvailableException(
                    "Machine " + request.getMachineId() + " is not available (status: " + machine.getStatus() + ")");
        }

        machineCycleRepository.findByMachineIdAndStatus(request.getMachineId(), CycleStatus.IN_PROGRESS)
                .ifPresent(c -> {
                    throw new MachineNotAvailableException(
                            "Machine " + request.getMachineId() + " already has an active cycle");
                });

        // ── Reservation gating ────────────────────────────────────────────────
        // If the feature is on and this machine is currently held by an active reservation,
        // the start request MUST carry the matching reservation code (checked by code + machine,
        // not by user). A valid code is consumed (marked USED) here.
        reservationService.activeReservationCovering(request.getMachineId()).ifPresent(reserved -> {
            if (!StringUtils.hasText(request.getReservationCode())) {
                throw new MachineNotAvailableException(
                        "Machine " + request.getMachineId()
                                + " is reserved right now — a reservation code is required to start it");
            }
            Reservation consumed = reservationService.validateAndConsume(
                    request.getReservationCode().trim(), request.getMachineId());
            log.info("Reservation {} redeemed to start machine {}",
                    consumed.getReservationCode(), request.getMachineId());
        });

        LocalDateTime now = LocalDateTime.now();
        LocalDateTime endsAt = now.plusMinutes(request.getDurationMinutes());

        CycleType cycleType;
        try {
            cycleType = CycleType.valueOf(request.getCycleType().toUpperCase());
        } catch (IllegalArgumentException e) {
            cycleType = CycleType.NORMAL;
        }

        // ── Persist cycle record ──────────────────────────────────────────────
        MachineCycle cycle = MachineCycle.builder()
                .machineId(request.getMachineId())
                .cycleType(cycleType)
                .status(CycleStatus.IN_PROGRESS)
                .durationMinutes(request.getDurationMinutes())
                .startedAt(now)
                .endsAt(endsAt)
                .rfidCardUid(request.getRfidCardUid())
                .transactionReference(request.getTransactionReference())
                .pulseCount(request.getPulseCount())
                .build();
        try {
            machineCycleRepository.save(cycle);
        } catch (DataIntegrityViolationException exception) {
            // Backstop for the locked-fetch guard above, in case some future caller
            // bypasses it: the partial unique index on machine_cycles(machine_id)
            // WHERE status='IN_PROGRESS' is the last line of defense.
            String cause = String.valueOf(exception.getMostSpecificCause().getMessage());
            if (cause.contains("idx_machine_cycles_machine_in_progress")) {
                throw new MachineNotAvailableException(
                        "Machine " + request.getMachineId() + " already has an active cycle");
            }
            throw exception;
        }
        meterRegistry.counter("machine.cycle.started.total",
                "machine_id", request.getMachineId(),
                "cycle_type", cycleType.name()).increment();

        machine.setStatus(MachineStatus.RUNNING);
        machine.setCurrentCycleType(cycleType);
        machine.setCycleStartedAt(now);
        machine.setCycleDurationMinutes(request.getDurationMinutes());
        machine.setCycleEndsAt(endsAt);
        machine.setCycleProgress(0);
        machine.setDoorLocked(true);
        machineRepository.save(machine);

        // ── Command dispatch: routes to real hardware or simulator no-op ─────
        commandDispatcher.dispatch(machine, request, cycleType);

        recordEvent(request.getMachineId(), "CYCLE_STARTED",
                MachineStatus.IDLE.name(), MachineStatus.RUNNING.name(),
                "Cycle: " + cycleType + ", Duration: " + request.getDurationMinutes() + "min",
                request.getRfidCardUid(), request.getTransactionReference());

        log.info("Cycle started: machine={}, type={}, duration={}min, endsAt={}",
                request.getMachineId(), cycleType, request.getDurationMinutes(), endsAt);

        return cycle;
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    public MachineStatusResponse getMachineStatus(String machineId) {
        Machine machine = machineRepository.findByMachineId(machineId)
                .orElseThrow(() -> new MachineNotFoundException("Machine not found: " + machineId));
        return toStatusResponse(machine);
    }

    public MachineSummaryResponse getAllMachines() {
        List<Machine> machines = machineRepository.findAll();
        List<MachineStatusResponse> responses = machines.stream()
                .map(this::toStatusResponse)
                .collect(Collectors.toList());

        int available    = (int) machines.stream().filter(Machine::isAvailable).count();
        int inUse        = (int) machines.stream().filter(m -> m.getStatus() == MachineStatus.RUNNING).count();
        int offline      = (int) machines.stream().filter(m -> !m.getIsOnline()).count();
        int error        = (int) machines.stream().filter(m -> m.getStatus() == MachineStatus.ERROR).count();
        int maintenance  = (int) machines.stream().filter(m -> m.getStatus() == MachineStatus.MAINTENANCE).count();

        return MachineSummaryResponse.builder()
                .machines(responses)
                .total(machines.size())
                .available(available)
                .inUse(inUse)
                .offline(offline)
                .error(error)
                .maintenance(maintenance)
                .build();
    }

    public List<MachineEvent> getMachineEvents(String machineId) {
        return machineEventRepository.findTop50ByMachineIdOrderByCreatedAtDesc(machineId);
    }

    public List<MachineCycle> getMachineCycles(String machineId) {
        return machineCycleRepository.findByMachineIdOrderByCreatedAtDesc(machineId);
    }

    @Transactional
    public void sendCommand(String machineId, String action) {
        Machine machine = machineRepository.findByMachineId(machineId)
                .orElseThrow(() -> new MachineNotFoundException("Machine not found: " + machineId));

        // Note: EQLink has no remote stop endpoint in its v2 API.
        // A stop command can only be issued via MQTT to the local ESP32 relay.
        mqttService.sendCommand(machineId, action, null);

        recordEvent(machineId, "COMMAND_SENT",
                machine.getStatus().name(), null, "Command: " + action, null, null);
    }

    // ── Mapping ───────────────────────────────────────────────────────────────

    private MachineStatusResponse toStatusResponse(Machine machine) {
        Integer remainingMinutes = null;
        if (machine.getCycleEndsAt() != null && machine.getStatus() == MachineStatus.RUNNING) {
            long remaining = ChronoUnit.MINUTES.between(LocalDateTime.now(), machine.getCycleEndsAt());
            remainingMinutes = (int) Math.max(0, remaining);
        }

        return MachineStatusResponse.builder()
                .machineId(machine.getMachineId())
                .displayName(machine.getDisplayName())
                .type(machine.getType())
                .status(machine.getStatus())
                .online(machine.getIsOnline())
                .available(machine.isAvailable())
                .currentCycleType(machine.getCurrentCycleType())
                .cycleStartedAt(machine.getCycleStartedAt())
                .cycleEndsAt(machine.getCycleEndsAt())
                .cycleProgress(machine.getCycleProgress())
                .remainingMinutes(remainingMinutes)
                .doorLocked(machine.getDoorLocked())
                .temperature(machine.getTemperature())
                .errorCode(machine.getErrorCode())
                .errorMessage(machine.getErrorMessage())
                .lastHeartbeat(machine.getLastHeartbeat())
                .build();
    }

    private void recordEvent(String machineId, String eventType, String previousStatus,
                             String newStatus, String details, String rfidCardUid, String transactionRef) {
        MachineEvent event = MachineEvent.builder()
                .machineId(machineId)
                .eventType(eventType)
                .previousStatus(previousStatus)
                .newStatus(newStatus)
                .details(details)
                .rfidCardUid(rfidCardUid)
                .transactionReference(transactionRef)
                .build();
        machineEventRepository.save(event);
    }
}
