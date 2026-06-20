package com.smartlaundromat.machine.modbus.dto;

import lombok.Data;

/**
 * Reply from the serial↔HTTP Modbus gateway bridge.
 *
 * <p>{@code frameHex} is the raw RTU reply from the slave (space-separated hex). For a
 * write (0x10) this echoes {@code unit | 0x10 | addrHi addrLo | qtyHi qtyLo | crcLo crcHi};
 * for a read (0x03) it carries the requested register block.
 */
@Data
public class ModbusGatewayResponse {

    /** Raw RTU reply frame as space-separated hex. */
    private String frameHex;

    /** Convenience flag set by the gateway; {@code false} signals a bus/timeout error. */
    private boolean success = true;

    /** Optional human-readable message (e.g. timeout / CRC error). */
    private String message;
}
