package com.smartlaundromat.machine.modbus;

import com.smartlaundromat.machine.modbus.dto.ModbusGatewayRequest;
import com.smartlaundromat.machine.modbus.dto.ModbusGatewayResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

/**
 * Modbus RTU client that routes commands through a serial-to-HTTP gateway bridge.
 *
 * <p>Start sequence for washers (hardware constraint — order is mandatory):
 * {@link WasherModbusRegisters#REG_PROGRAM_SELECT} → {@link WasherModbusRegisters#REG_COIN_INPUT}
 * → {@link WasherModbusRegisters#REG_START}.
 *
 * <p>All public methods are safe no-ops (return {@code false}/{@code null}) when Modbus is
 * disabled, the machine has no slave mapping, or the machine type has no register definition yet.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class ModbusClient {

    private final ModbusProperties props;
    private final RestTemplate restTemplate;

    /**
     * Starts a washer: select program → input coins → start.
     *
     * @param machineId     internal machine ID (must be mapped to a slave address)
     * @param coins         number of coins to credit (≥ 1)
     * @param programNumber program 1–3 (clamped into range)
     * @return {@code true} when the START write was acknowledged by the slave
     */
    public boolean startMachine(String machineId, int coins, int programNumber) {
        if (!props.isModbusMachine(machineId)) {
            log.debug("Modbus not enabled/mapped for {} — skipping", machineId);
            return false;
        }
        if (!isWasherMachine(machineId)) {
            log.warn("Dryer Modbus registers not yet defined — skipping start for {}", machineId);
            return false;
        }
        int unitId = props.resolveUnitId(machineId).orElseThrow();
        int program = Math.max(1, Math.min(3, programNumber));
        int coinCount = Math.max(1, coins);

        boolean programOk = write(unitId, WasherModbusRegisters.REG_PROGRAM_SELECT, program, "select-program");
        boolean coinsOk = write(unitId, WasherModbusRegisters.REG_COIN_INPUT, coinCount, "input-coins");
        boolean startOk = write(unitId, WasherModbusRegisters.REG_START, 1, "start");

        log.info("Modbus start machine={} unit={} program={} coins={} -> programOk={} coinsOk={} startOk={}",
                machineId, unitId, program, coinCount, programOk, coinsOk, startOk);

        return startOk;
    }

    public boolean forcedStop(String machineId) {
        if (!props.isModbusMachine(machineId)) return false;
        if (!isWasherMachine(machineId)) {
            log.warn("Dryer Modbus registers not yet defined — skipping forced-stop for {}", machineId);
            return false;
        }
        int unitId = props.resolveUnitId(machineId).orElseThrow();

        return write(unitId, WasherModbusRegisters.REG_FORCE_STOP, 1, "forced-stop");
    }

    public boolean resetAlarm(String machineId) {
        if (!props.isModbusMachine(machineId)) return false;
        if (!isWasherMachine(machineId)) {
            log.warn("Dryer Modbus registers not yet defined — skipping reset-alarm for {}", machineId);
            return false;
        }
        int unitId = props.resolveUnitId(machineId).orElseThrow();

        return write(unitId, WasherModbusRegisters.REG_RESET_ALARM, 1, "reset-alarm");
    }

    /**
     * Reads the 20-register washer status block and decodes it.
     *
     * @return decoded status, or {@code null} on error / non-washer / when not a Modbus machine
     */
    public WasherModbusStatus readWasherStatus(String machineId) {
        if (!props.isModbusMachine(machineId)) return null;
        if (!isWasherMachine(machineId)) {
            log.warn("Dryer Modbus registers not yet defined — skipping status read for {}", machineId);
            return null;
        }
        int unitId = props.resolveUnitId(machineId).orElseThrow();
        try {
            byte[] frame = ModbusFrameUtil.buildReadHoldingRegisters(
                    unitId, WasherModbusRegisters.REG_STATUS_BASE, WasherModbusRegisters.STATUS_REGISTER_COUNT);

            ModbusGatewayResponse response = send(unitId, ModbusFrameUtil.FUNC_READ_HOLDING, frame);
            if (response == null || !response.isSuccess() || response.getFrameHex() == null) {
                log.warn("Modbus read washer status failed for {} (unit {})", machineId, unitId);
                return null;
            }
            byte[] reply = ModbusFrameUtil.fromHex(response.getFrameHex());
            if (!ModbusFrameUtil.isCrcValid(reply)) {
                log.warn("Modbus read washer status CRC mismatch for {} (unit {})", machineId, unitId);
                return null;
            }
            int[] registers = ModbusFrameUtil.parseReadResponse(reply);

            return WasherModbusStatus.from(registers);
        } catch (Exception exception) {
            log.error("Modbus readWasherStatus {} error: {}", machineId, exception.getMessage());
            return null;
        }
    }

    // ── Internals ────────────────────────────────────────────────────────────────

    private boolean isWasherMachine(String machineId) {
        return machineId.startsWith("washer");
    }

    private boolean write(int unitId, int address, int value, String label) {
        try {
            byte[] frame = ModbusFrameUtil.buildWriteSingleRegister(unitId, address, value);
            ModbusGatewayResponse response = send(unitId, ModbusFrameUtil.FUNC_WRITE_MULTIPLE, frame);
            boolean ok = response != null && response.isSuccess();
            if (!ok) {
                log.warn("Modbus {} write failed unit={} reg=0x{} value={}",
                        label, unitId, Integer.toHexString(address), value);
            }

            return ok;
        } catch (Exception exception) {
            log.error("Modbus {} write error unit={}: {}", label, unitId, exception.getMessage());
            return false;
        }
    }

    private ModbusGatewayResponse send(int unitId, int function, byte[] frame) {
        String url = props.getGatewayUrl() + props.getRequestPath();
        ModbusGatewayRequest requestBody = ModbusGatewayRequest.builder()
                .unitId(unitId)
                .function(function)
                .frameHex(ModbusFrameUtil.toHex(frame))
                .build();

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        ResponseEntity<ModbusGatewayResponse> response = restTemplate.exchange(
                url, HttpMethod.POST, new HttpEntity<>(requestBody, headers), ModbusGatewayResponse.class);

        return response.getBody();
    }
}
