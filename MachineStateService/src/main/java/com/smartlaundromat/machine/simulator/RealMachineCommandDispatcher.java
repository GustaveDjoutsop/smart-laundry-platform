package com.smartlaundromat.machine.simulator;

import com.smartlaundromat.contracts.machine.MachineStartRequest;
import com.smartlaundromat.machine.eqlink.EqLinkClient;
import com.smartlaundromat.machine.eqlink.EqLinkProperties;
import com.smartlaundromat.machine.model.Machine;
import com.smartlaundromat.machine.model.enums.CommProtocol;
import com.smartlaundromat.machine.model.enums.CycleType;
import com.smartlaundromat.machine.modbus.ModbusClient;
import com.smartlaundromat.machine.modbus.ModbusProperties;
import com.smartlaundromat.machine.mqtt.MqttService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * Production command dispatcher.
 * <p>
 * Strategy (same as the former {@code MachineService.dispatchStartCommand}):
 * <ol>
 *   <li>MODBUS machine + modbus enabled → Modbus RTU start + MQTT safety net</li>
 *   <li>EQLINK machine + eqlink enabled → EQLink IoT start + MQTT safety net
 *       (falls back to MQTT only on IoT timeout)</li>
 *   <li>Otherwise → MQTT only</li>
 * </ol>
 */
@Component
@Slf4j
@RequiredArgsConstructor
@ConditionalOnProperty(name = "simulator.enabled", havingValue = "false", matchIfMissing = true)
public class RealMachineCommandDispatcher implements MachineCommandDispatcher {

    private final EqLinkClient eqLinkClient;
    private final EqLinkProperties eqLinkProperties;
    private final ModbusClient modbusClient;
    private final ModbusProperties modbusProperties;
    private final MqttService mqttService;

    @Override
    public void dispatch(Machine machine, MachineStartRequest request, CycleType cycleType) {
        // ── Modbus RTU machines ───────────────────────────────────────────────
        if (machine.getCommProtocol() == CommProtocol.MODBUS && modbusProperties.isEnabled()) {
            int program = modbusProgramFor(cycleType);
            boolean acked = modbusClient.startMachine(request.machineId(), request.pulseCount(), program);
            if (!acked) {
                log.warn("Modbus start did not ack for {} — MQTT is the fallback", request.machineId());
            }
            mqttService.sendCommand(request.machineId(), "pulse", request.pulseCount());
            log.debug("Command dispatch: machine={}, modbus={}, mqtt=sent",
                    request.machineId(), acked ? "sent" : "skipped");
            return;
        }

        // ── EQLink machines ───────────────────────────────────────────────────
        boolean eqLinkDispatched = false;
        if (machine.getCommProtocol() == CommProtocol.EQLINK && eqLinkProperties.isEnabled()) {
            eqLinkDispatched = eqLinkProperties.resolveDeviceName(request.machineId())
                    .map(devicename -> {
                        int vendPrice = eqLinkProperties.getDefaultVendPrice();
                        var statusResp = eqLinkClient.checkDeviceStatus(devicename);
                        if (statusResp != null && statusResp.isSuccess()
                                && statusResp.getDeviceStatus() != null
                                && statusResp.getDeviceStatus().getVendPrice() != null
                                && statusResp.getDeviceStatus().getVendPrice() > 0) {
                            vendPrice = statusResp.getDeviceStatus().getVendPrice();
                        }

                        var startResp = eqLinkClient.startDeviceIot(devicename, request.pulseCount(), vendPrice);
                        if (startResp == null) {
                            log.warn("EQLink IoT start returned null for {} — MQTT will handle it",
                                    request.machineId());
                            return false;
                        }
                        if (startResp.isIotTimeout()) {
                            log.warn("EQLink IoT timeout (406) for {} — MQTT is the fallback",
                                    request.machineId());
                            return false;
                        }
                        return startResp.isSuccess();
                    })
                    .orElseGet(() -> {
                        log.warn("EQLink enabled but no devicename mapping for {} — using MQTT only",
                                request.machineId());
                        return false;
                    });
        }

        // MQTT: sole trigger when EQLink is disabled; safety net + fallback when EQLink fails/times out
        mqttService.sendCommand(request.machineId(), "pulse", request.pulseCount());
        log.debug("Command dispatch: machine={}, eqlink={}, mqtt=sent",
                request.machineId(), eqLinkDispatched ? "sent" : "skipped");
    }

    /**
     * Maps a {@link CycleType} to a Modbus program number (1–3).
     * Short/quick → 1, normal → 2, heavy/long → 3.
     */
    static int modbusProgramFor(CycleType cycleType) {
        return switch (cycleType) {
            case QUICK, DELICATE, LOW_HEAT, COTTON_40 -> 1;
            case HEAVY, SANITIZE, HIGH_HEAT, COTTON_90 -> 3;
            default -> 2;
        };
    }
}
