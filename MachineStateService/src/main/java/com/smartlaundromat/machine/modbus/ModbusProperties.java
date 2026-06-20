package com.smartlaundromat.machine.modbus;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

/**
 * Configuration properties for the Modbus RTU integration (feature-flagged).
 *
 * <h2>What this is</h2>
 * Some machines speak <strong>Modbus RTU over RS485</strong> instead of EQLink. RS485 is a
 * serial bus, so the backend reaches it through a <em>serial↔HTTP gateway bridge</em>: the
 * backend POSTs the hex RTU frame to the gateway, which puts it on the wire and returns the
 * slave's reply. For local development the gateway is simulated by WireMock.
 *
 * <h2>Slave addressing</h2>
 * Each machine is a Modbus slave with an address in the range 1–247. Map internal machine IDs
 * (e.g. {@code washer_07}) to slave addresses via {@code modbus.unit-id-mapping}.
 *
 * <h2>Example {@code ci/dev.yaml}</h2>
 * <pre>{@code
 * modbus:
 *   enabled: true
 *   gateway-url: http://localhost:9090     # WireMock Modbus gateway simulator
 *   request-path: /modbus/rtu
 *   default-coins: 1
 *   unit-id-mapping:
 *     washer_07: 1
 *     washer_08: 2
 *     dryer_05:  6
 * }</pre>
 */
@Data
@Component
@ConfigurationProperties(prefix = "modbus")
public class ModbusProperties {

    /** Master switch — set {@code true} to activate Modbus RTU control. Default {@code false}. */
    private boolean enabled = false;

    /** Base URL of the serial↔HTTP Modbus gateway bridge (WireMock in dev). */
    private String gatewayUrl = "http://localhost:9090";

    /** Path on the gateway that accepts a hex RTU frame and returns the slave reply. */
    private String requestPath = "/modbus/rtu";

    /** Default number of coins (pulses) to inject when not supplied per request. */
    private int defaultCoins = 1;

    /**
     * Maps internal machine IDs to Modbus slave addresses (1–247).
     * Only machines present here are treated as Modbus machines.
     */
    private Map<String, Integer> unitIdMapping = new HashMap<>();

    /** Resolves the slave address for a machine, or empty when not a Modbus machine. */
    public Optional<Integer> resolveUnitId(String machineId) {
        return Optional.ofNullable(unitIdMapping.get(machineId));
    }

    /** {@code true} when the integration is enabled and the machine has a slave-address mapping. */
    public boolean isModbusMachine(String machineId) {
        return enabled && unitIdMapping.containsKey(machineId);
    }

    /** {@code true} when enabled and a gateway URL is configured. */
    public boolean isFullyConfigured() {
        return enabled && StringUtils.hasText(gatewayUrl);
    }
}
