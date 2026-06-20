package com.smartlaundromat.machine.modbus;

import org.springframework.util.StringUtils;

/**
 * Builds and parses Modbus RTU frames.
 *
 * <h2>CRC16 (Modbus)</h2>
 * Polynomial {@code 0xA001} (reflected {@code 0x8005}), initial value {@code 0xFFFF}.
 * The two CRC bytes are appended <strong>low byte first, then high byte</strong>.
 *
 * <h2>Write frame (function 0x10, single register)</h2>
 * <pre>
 *   unit | 0x10 | addrHi addrLo | qtyHi qtyLo(=0x0001) | byteCount(=0x02) | valHi valLo | crcLo crcHi
 * </pre>
 * Example — start washer on slave 1 ({@link WasherModbusRegisters#REG_START}=0x0479, value 1):
 * <pre>01 10 04 79 00 01 02 00 01 29 F9</pre>
 *
 * <h2>Read frame (function 0x03)</h2>
 * <pre>
 *   unit | 0x03 | addrHi addrLo | qtyHi qtyLo | crcLo crcHi
 * </pre>
 * Example — read 20 status registers on slave 1 ({@link WasherModbusRegisters#REG_STATUS_BASE}=0x048C):
 * <pre>01 03 04 8C 00 14 85 1E</pre>
 */
public final class ModbusFrameUtil {

    private ModbusFrameUtil() { }

    // ── Generic Modbus function codes ────────────────────────────────────────────
    public static final int FUNC_READ_HOLDING  = 0x03;
    public static final int FUNC_WRITE_MULTIPLE = 0x10;

    // ── CRC16 ───────────────────────────────────────────────────────────────────

    /** Computes the Modbus CRC16 of {@code data} (initial 0xFFFF, poly 0xA001). */
    public static int crc16(byte[] data, int length) {
        int crc = 0xFFFF;
        for (int i = 0; i < length; i++) {
            crc ^= (data[i] & 0xFF);
            for (int b = 0; b < 8; b++) {
                if ((crc & 0x0001) != 0) {
                    crc >>= 1;
                    crc ^= 0xA001;
                } else {
                    crc >>= 1;
                }
            }
        }
        return crc & 0xFFFF;
    }

    private static byte[] appendCrc(byte[] pdu) {
        int crc = crc16(pdu, pdu.length);
        byte[] frame = new byte[pdu.length + 2];
        System.arraycopy(pdu, 0, frame, 0, pdu.length);
        frame[pdu.length]     = (byte) (crc & 0xFF);        // CRC low byte first
        frame[pdu.length + 1] = (byte) ((crc >> 8) & 0xFF); // CRC high byte
        return frame;
    }

    // ── Frame builders ───────────────────────────────────────────────────────────

    /**
     * Builds a "write single holding register" frame (function 0x10, quantity 1).
     *
     * @param unitId  slave address (1–247)
     * @param address zero-based register address (e.g. {@link WasherModbusRegisters#REG_START})
     * @param value   16-bit value to write (0–65535)
     * @return complete RTU frame including CRC
     */
    public static byte[] buildWriteSingleRegister(int unitId, int address, int value) {
        byte[] pdu = new byte[] {
                (byte) unitId,
                (byte) FUNC_WRITE_MULTIPLE,
                (byte) ((address >> 8) & 0xFF),
                (byte) (address & 0xFF),
                0x00, 0x01,            // quantity of registers = 1
                0x02,                  // byte count = 2
                (byte) ((value >> 8) & 0xFF),
                (byte) (value & 0xFF)
        };
        return appendCrc(pdu);
    }

    /**
     * Builds a "read holding registers" frame (function 0x03).
     *
     * @param unitId   slave address (1–247)
     * @param address  zero-based starting register address
     * @param quantity number of 16-bit registers to read
     * @return complete RTU frame including CRC
     */
    public static byte[] buildReadHoldingRegisters(int unitId, int address, int quantity) {
        byte[] pdu = new byte[] {
                (byte) unitId,
                (byte) FUNC_READ_HOLDING,
                (byte) ((address >> 8) & 0xFF),
                (byte) (address & 0xFF),
                (byte) ((quantity >> 8) & 0xFF),
                (byte) (quantity & 0xFF)
        };
        return appendCrc(pdu);
    }

    // ── Frame parsing ─────────────────────────────────────────────────────────────

    /**
     * Validates a received frame's CRC.
     *
     * @return {@code true} if the trailing CRC matches the computed CRC of the body
     */
    public static boolean isCrcValid(byte[] frame) {
        if (frame == null || frame.length < 4) return false;
        int bodyLen = frame.length - 2;
        int expected = crc16(frame, bodyLen);
        int actual = (frame[bodyLen] & 0xFF) | ((frame[bodyLen + 1] & 0xFF) << 8);
        return expected == actual;
    }

    /**
     * Extracts the register values from a function-0x03 read response.
     * Response layout: {@code unit | 0x03 | byteCount | data... | crcLo crcHi}.
     *
     * @return array of unsigned 16-bit register values, or empty array if malformed
     */
    public static int[] parseReadResponse(byte[] frame) {
        if (frame == null || frame.length < 5) return new int[0];
        int byteCount = frame[2] & 0xFF;
        int registers = byteCount / 2;
        if (frame.length < 3 + byteCount + 2) return new int[0];
        int[] values = new int[registers];
        for (int i = 0; i < registers; i++) {
            int hi = frame[3 + i * 2] & 0xFF;
            int lo = frame[3 + i * 2 + 1] & 0xFF;
            values[i] = (hi << 8) | lo;
        }
        return values;
    }

    // ── Hex helpers ───────────────────────────────────────────────────────────────

    /** Renders a frame as space-separated upper-case hex (e.g. {@code "01 10 04 79"}). */
    public static String toHex(byte[] frame) {
        StringBuilder sb = new StringBuilder(frame.length * 3);
        for (int i = 0; i < frame.length; i++) {
            if (i > 0) sb.append(' ');
            sb.append(String.format("%02X", frame[i] & 0xFF));
        }
        return sb.toString();
    }

    /** Parses space- or comma-separated hex (e.g. {@code "01 10 04 79"}) into bytes. */
    public static byte[] fromHex(String hex) {
        if (!StringUtils.hasText(hex)) return new byte[0];
        String[] tokens = hex.trim().split("[\\s,]+");
        byte[] out = new byte[tokens.length];
        for (int i = 0; i < tokens.length; i++) {
            out[i] = (byte) (Integer.parseInt(tokens[i], 16) & 0xFF);
        }
        return out;
    }
}
