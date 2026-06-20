package com.smartlaundromat.machine.service;

import com.smartlaundromat.machine.config.MachineConfig;
import com.smartlaundromat.machine.dto.*;
import com.smartlaundromat.machine.eqlink.EqLinkClient;
import com.smartlaundromat.machine.eqlink.EqLinkProperties;
import com.smartlaundromat.machine.modbus.ModbusClient;
import com.smartlaundromat.machine.modbus.ModbusProperties;
import com.smartlaundromat.machine.model.Reservation;

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
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;

/**
 * Core machine lifecycle service.
 *
 * <h2>Command dispatch strategy</h2>
 * <ol>
 *   <li>If {@code eqlink.enabled=true} <em>and</em> the machine has an EQLink device
 *       mapping → send the start command via EQLink REST API.</li>
 *   <li>Always also send the MQTT pulse (to the ESP32 local relay) as a safety net
 *       so the machine starts even when EQLink has a hiccup.</li>
 *   <li>If EQLink is disabled → use MQTT only (existing behaviour).</li>
 * </ol>
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

    /** EQLink integration — always injected; all methods are no-ops when disabled. */
    private final EqLinkClient eqLinkClient;
    private final EqLinkProperties eqLinkProperties;

    /** Modbus RTU integration — always injected; all methods are no-ops when disabled. */
    private final ModbusClient modbusClient;
    private final ModbusProperties modbusProperties;

    /** Reservation gating — enforces that reserved machines need a valid code to start. */
    private final ReservationService reservationService;

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
                return existing.get();
            }
        }

        Machine machine = machineRepository.findByMachineId(request.getMachineId())
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
        machineCycleRepository.save(cycle);

        machine.setStatus(MachineStatus.RUNNING);
        machine.setCurrentCycleType(cycleType);
        machine.setCycleStartedAt(now);
        machine.setCycleDurationMinutes(request.getDurationMinutes());
        machine.setCycleEndsAt(endsAt);
        machine.setCycleProgress(0);
        machine.setDoorLocked(true);
        machineRepository.save(machine);

        // ── Command dispatch: EQLink / Modbus + MQTT ──────────────────────────
        dispatchStartCommand(machine, request, cycleType);

        recordEvent(request.getMachineId(), "CYCLE_STARTED",
                MachineStatus.IDLE.name(), MachineStatus.RUNNING.name(),
                "Cycle: " + cycleType + ", Duration: " + request.getDurationMinutes() + "min",
                request.getRfidCardUid(), request.getTransactionReference());

        log.info("Cycle started: machine={}, type={}, duration={}min, eqlink={}, endsAt={}",
                request.getMachineId(), cycleType, request.getDurationMinutes(),
                eqLinkProperties.isEnabled(), endsAt);

        return cycle;
    }

    /**
     * Dispatches the start command using the configured strategy.
     *
     * <h3>Strategy</h3>
     * <ol>
     *   <li>If EQLink is enabled and the machine has a {@code devicename} mapping:
     *     <ol>
     *       <li>Call {@code iot_check_dev_status} to get the machine's current {@code vend_price}.</li>
     *       <li>Compute {@code total_amt = pulseCount × vend_price}.</li>
     *       <li>Send {@code iot_start_device}.</li>
     *       <li>If EQLink IoT times out (406), fall back to MQTT automatically.</li>
     *     </ol>
     *   </li>
     *   <li>Always also fire the MQTT pulse — belt-and-suspenders approach.</li>
     *   <li>If EQLink is disabled or not mapped → MQTT only.</li>
     * </ol>
     */
    private void dispatchStartCommand(Machine machine, StartCycleRequest request, CycleType cycleType) {
        boolean primaryDispatched = false;

        // ── Modbus RTU machines ───────────────────────────────────────────────
        if (machine.getCommProtocol() == CommProtocol.MODBUS && modbusProperties.isEnabled()) {
            int program = modbusProgramFor(cycleType);
            primaryDispatched = modbusClient.startMachine(
                    request.getMachineId(), request.getPulseCount(), program);
            if (!primaryDispatched) {
                log.warn("Modbus start did not ack for {} — MQTT is the fallback", request.getMachineId());
            }
            // MQTT safety net + done (Modbus machines are not on EQLink).
            mqttService.sendCommand(request.getMachineId(), "pulse", request.getPulseCount());
            log.debug("Command dispatch: machine={}, modbus={}, mqtt=sent",
                    request.getMachineId(), primaryDispatched ? "sent" : "skipped");
            return;
        }

        boolean eqLinkDispatched = false;

        if (machine.getCommProtocol() == CommProtocol.EQLINK && eqLinkProperties.isEnabled()) {
            eqLinkDispatched = eqLinkProperties.resolveDeviceName(request.getMachineId())
                    .map(devicename -> {
                        // Step 1: get vend_price from a fresh status check
                        int vendPrice = eqLinkProperties.getDefaultVendPrice();
                        var statusResp = eqLinkClient.checkDeviceStatus(devicename);
                        if (statusResp != null && statusResp.isSuccess()
                                && statusResp.getDeviceStatus() != null
                                && statusResp.getDeviceStatus().getVendPrice() != null
                                && statusResp.getDeviceStatus().getVendPrice() > 0) {
                            vendPrice = statusResp.getDeviceStatus().getVendPrice();
                        }

                        // Step 2: send IoT start (total_amt = pulseCount × vend_price)
                        var startResp = eqLinkClient.startDeviceIot(
                                devicename, request.getPulseCount(), vendPrice);

                        if (startResp == null) {
                            log.warn("EQLink IoT start returned null for {} — MQTT will handle it",
                                    request.getMachineId());
                            return false;
                        }
                        if (startResp.isIotTimeout()) {
                            log.warn("EQLink IoT timeout (406) for {} — MQTT is the fallback",
                                    request.getMachineId());
                            return false; // let MQTT handle it below
                        }
                        return startResp.isSuccess();
                    })
                    .orElseGet(() -> {
                        log.warn("EQLink enabled but no devicename mapping for {} — using MQTT only",
                                request.getMachineId());
                        return false;
                    });
        }

        // Always fire the MQTT pulse as well (belt-and-suspenders):
        // - When EQLink is disabled: MQTT is the sole trigger
        // - When EQLink succeeds:    MQTT acts as a local relay fallback
        // - When EQLink fails:       MQTT becomes the primary trigger
        mqttService.sendCommand(request.getMachineId(), "pulse", request.getPulseCount());

        log.debug("Command dispatch: machine={}, eqlink={}, mqtt=sent",
                request.getMachineId(), eqLinkDispatched ? "sent" : "skipped");
    }

    /**
     * Maps a {@link CycleType} to a Modbus program number (1–3) for register
     * {@code REG_SELECT_PROGRAM}. Short/quick → 1, normal → 2, heavy/long → 3.
     */
    private int modbusProgramFor(CycleType cycleType) {
        return switch (cycleType) {
            case QUICK, DELICATE, LOW_HEAT, COTTON_40 -> 1;
            case HEAVY, SANITIZE, HIGH_HEAT, COTTON_90 -> 3;
            default -> 2;
        };
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
