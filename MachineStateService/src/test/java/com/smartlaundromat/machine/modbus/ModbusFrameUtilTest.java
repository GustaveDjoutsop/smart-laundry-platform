package com.smartlaundromat.machine.modbus;

import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.assertThat;

class ModbusFrameUtilTest {

    // ── CRC16 ──────────────────────────────────────────────────────────────────

    @Test
    void shouldComputeKnownCrc16() {
        // given — Modbus RTU frame for "start washer slave 1" without CRC:
        //   01 10 04 79 00 01 02 00 01
        byte[] data = {0x01, 0x10, 0x04, 0x79, 0x00, 0x01, 0x02, 0x00, 0x01};

        // when
        int crc = ModbusFrameUtil.crc16(data, data.length);

        // then — expected CRC: 0xF929 (stored as low=0x29, high=0xF9)
        assertThat(crc).isEqualTo(0xF929);
    }

    @Test
    void shouldComputeCrc16ForEmptyData() {
        // given
        byte[] data = new byte[0];

        // when
        int crc = ModbusFrameUtil.crc16(data, 0);

        // then — initial value unmodified
        assertThat(crc).isEqualTo(0xFFFF);
    }

    // ── buildWriteSingleRegister ───────────────────────────────────────────────

    @Test
    void shouldBuildWriteFrameWithCorrectStructure() {
        // given — write register 0x0479 with value 1 on slave 1
        // expected: 01 10 04 79 00 01 02 00 01 29 F9

        // when
        byte[] frame = ModbusFrameUtil.buildWriteSingleRegister(1, 0x0479, 1);

        // then
        assertThat(frame).hasSize(11); // 9-byte PDU + 2-byte CRC
        assertThat(frame[0]).isEqualTo((byte) 0x01); // unit ID
        assertThat(frame[1]).isEqualTo((byte) 0x10); // function code
        assertThat(frame[2]).isEqualTo((byte) 0x04); // address high
        assertThat(frame[3]).isEqualTo((byte) 0x79); // address low
        assertThat(frame[4]).isEqualTo((byte) 0x00); // qty high
        assertThat(frame[5]).isEqualTo((byte) 0x01); // qty low
        assertThat(frame[6]).isEqualTo((byte) 0x02); // byte count
        assertThat(frame[7]).isEqualTo((byte) 0x00); // value high
        assertThat(frame[8]).isEqualTo((byte) 0x01); // value low
        // CRC must be valid
        assertThat(ModbusFrameUtil.isCrcValid(frame)).isTrue();
    }

    @Test
    void shouldBuildWriteFrameMatchingDocumentedExample() {
        // given — documented example: 01 10 04 79 00 01 02 00 01 29 F9
        // when
        byte[] frame = ModbusFrameUtil.buildWriteSingleRegister(1, 0x0479, 1);

        // then
        String hex = ModbusFrameUtil.toHex(frame);
        assertThat(hex).isEqualTo("01 10 04 79 00 01 02 00 01 29 F9");
    }

    // ── buildReadHoldingRegisters ──────────────────────────────────────────────

    @Test
    void shouldBuildReadFrameWithCorrectStructure() {
        // given — read 20 registers from 0x048C on slave 1
        // expected: 01 03 04 8C 00 14 85 1E

        // when
        byte[] frame = ModbusFrameUtil.buildReadHoldingRegisters(1, 0x048C, 20);

        // then
        assertThat(frame).hasSize(8); // 6-byte PDU + 2-byte CRC
        assertThat(frame[0]).isEqualTo((byte) 0x01);
        assertThat(frame[1]).isEqualTo((byte) 0x03);
        assertThat(ModbusFrameUtil.isCrcValid(frame)).isTrue();
    }

    @Test
    void shouldBuildReadFrameMatchingDocumentedExample() {
        // when
        byte[] frame = ModbusFrameUtil.buildReadHoldingRegisters(1, 0x048C, 20);

        // then
        String hex = ModbusFrameUtil.toHex(frame);
        assertThat(hex).isEqualTo("01 03 04 8C 00 14 85 1E");
    }

    // ── isCrcValid ─────────────────────────────────────────────────────────────

    @Test
    void shouldValidateCorrectFrame() {
        // given
        byte[] frame = ModbusFrameUtil.buildWriteSingleRegister(1, 0x0479, 1);

        // when / then
        assertThat(ModbusFrameUtil.isCrcValid(frame)).isTrue();
    }

    @Test
    void shouldRejectCorruptedFrame() {
        // given
        byte[] frame = ModbusFrameUtil.buildWriteSingleRegister(1, 0x0479, 1);
        frame[5] = (byte) 0xFF; // corrupt a byte

        // when / then
        assertThat(ModbusFrameUtil.isCrcValid(frame)).isFalse();
    }

    @Test
    void shouldReturnFalseForNullFrame() {
        // when / then
        assertThat(ModbusFrameUtil.isCrcValid(null)).isFalse();
    }

    @Test
    void shouldReturnFalseForTooShortFrame() {
        // when / then
        assertThat(ModbusFrameUtil.isCrcValid(new byte[]{0x01, 0x02})).isFalse();
        assertThat(ModbusFrameUtil.isCrcValid(new byte[]{0x01, 0x02, 0x03})).isFalse();
    }

    // ── parseReadResponse ──────────────────────────────────────────────────────

    @Test
    void shouldParseReadResponseCorrectly() {
        // given — slave reply: unit=1, func=0x03, byteCount=4, data=[0x0001, 0x0002], CRC
        byte[] pdu = {0x01, 0x03, 0x04, 0x00, 0x01, 0x00, 0x02};
        // Need to add CRC
        int crc = ModbusFrameUtil.crc16(pdu, pdu.length);
        byte[] frame = new byte[pdu.length + 2];
        System.arraycopy(pdu, 0, frame, 0, pdu.length);
        frame[pdu.length] = (byte) (crc & 0xFF);
        frame[pdu.length + 1] = (byte) ((crc >> 8) & 0xFF);

        // when
        int[] values = ModbusFrameUtil.parseReadResponse(frame);

        // then
        assertThat(values).hasSize(2);
        assertThat(values[0]).isEqualTo(1);
        assertThat(values[1]).isEqualTo(2);
    }

    @Test
    void shouldReturnEmptyArrayForNullFrame() {
        // when / then
        assertThat(ModbusFrameUtil.parseReadResponse(null)).isEmpty();
    }

    @Test
    void shouldReturnEmptyArrayForTooShortFrame() {
        // when / then
        assertThat(ModbusFrameUtil.parseReadResponse(new byte[]{0x01, 0x03})).isEmpty();
    }

    @Test
    void shouldReturnEmptyArrayForMalformedByteCount() {
        // given — byte count says 10 but frame is too short
        byte[] frame = {0x01, 0x03, 0x0A, 0x00, 0x01};

        // when
        int[] values = ModbusFrameUtil.parseReadResponse(frame);

        // then
        assertThat(values).isEmpty();
    }

    // ── toHex / fromHex ────────────────────────────────────────────────────────

    @Nested
    class HexConversion {

        @Test
        void shouldConvertToHex() {
            // given
            byte[] data = {0x01, 0x10, 0x04, 0x79};

            // when
            String hex = ModbusFrameUtil.toHex(data);

            // then
            assertThat(hex).isEqualTo("01 10 04 79");
        }

        @Test
        void shouldConvertFromHex() {
            // given
            String hex = "01 10 04 79";

            // when
            byte[] data = ModbusFrameUtil.fromHex(hex);

            // then
            assertThat(data).containsExactly(0x01, 0x10, 0x04, 0x79);
        }

        @Test
        void shouldRoundTripHexConversion() {
            // given
            byte[] original = {(byte) 0xFF, 0x00, 0x7E, (byte) 0xAB};

            // when
            byte[] result = ModbusFrameUtil.fromHex(ModbusFrameUtil.toHex(original));

            // then
            assertThat(result).containsExactly(original);
        }

        @ParameterizedTest
        @NullAndEmptySource
        @ValueSource(strings = {"  ", "\t"})
        void shouldReturnEmptyArrayForBlankInput(String input) {
            // when
            byte[] result = ModbusFrameUtil.fromHex(input);

            // then
            assertThat(result).isEmpty();
        }

        @Test
        void shouldParseCommaSeparatedHex() {
            // given
            String hex = "01,10,04,79";

            // when
            byte[] data = ModbusFrameUtil.fromHex(hex);

            // then
            assertThat(data).containsExactly(0x01, 0x10, 0x04, 0x79);
        }
    }

    // ── Constants ──────────────────────────────────────────────────────────────

    @Test
    void shouldExposeCorrectFunctionCodes() {
        assertThat(ModbusFrameUtil.FUNC_READ_HOLDING).isEqualTo(0x03);
        assertThat(ModbusFrameUtil.FUNC_WRITE_MULTIPLE).isEqualTo(0x10);
    }

    // ── Parameterized write frame tests ────────────────────────────────────────

    @ParameterizedTest
    @CsvSource({
            "1, 1145, 1",
            "2, 1145, 5",
            "247, 0, 65535"
    })
    void shouldBuildValidWriteFramesForVariousInputs(int unitId, int address, int value) {
        // when
        byte[] frame = ModbusFrameUtil.buildWriteSingleRegister(unitId, address, value);

        // then
        assertThat(frame).hasSize(11);
        assertThat(frame[0]).isEqualTo((byte) unitId);
        assertThat(ModbusFrameUtil.isCrcValid(frame)).isTrue();
    }

    @ParameterizedTest
    @CsvSource({
            "1, 1164, 1",
            "1, 1164, 20",
            "247, 0, 100"
    })
    void shouldBuildValidReadFramesForVariousInputs(int unitId, int address, int quantity) {
        // when
        byte[] frame = ModbusFrameUtil.buildReadHoldingRegisters(unitId, address, quantity);

        // then
        assertThat(frame).hasSize(8);
        assertThat(frame[0]).isEqualTo((byte) unitId);
        assertThat(ModbusFrameUtil.isCrcValid(frame)).isTrue();
    }
}
