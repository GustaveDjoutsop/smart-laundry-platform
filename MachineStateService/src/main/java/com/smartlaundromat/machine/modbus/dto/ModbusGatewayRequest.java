package com.smartlaundromat.machine.modbus.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request payload sent to the serial↔HTTP Modbus gateway bridge.
 *
 * <p>The gateway forwards {@code frameHex} verbatim onto the RS485 bus and returns the
 * slave's reply. {@code unitId} and {@code function} are included for convenience so the
 * gateway (or the WireMock simulator) can route/match without re-parsing the frame.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ModbusGatewayRequest {

    /** Target slave address (1–247). */
    private int unitId;

    /** Modbus function code (0x03 read, 0x10 write). */
    private int function;

    /** Complete RTU frame as space-separated hex, e.g. {@code "01 10 04 79 00 01 02 00 01 29 F9"}. */
    private String frameHex;
}
