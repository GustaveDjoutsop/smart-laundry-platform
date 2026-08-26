package com.smartlaundromat.machine.simulator;

import com.smartlaundromat.contracts.machine.MachineStartRequest;
import com.smartlaundromat.machine.eqlink.EqLinkClient;
import com.smartlaundromat.machine.eqlink.EqLinkProperties;
import com.smartlaundromat.machine.eqlink.dto.EqCheckStatusResponse;
import com.smartlaundromat.machine.eqlink.dto.EqDeviceInfo;
import com.smartlaundromat.machine.eqlink.dto.EqStartDeviceResponse;
import com.smartlaundromat.machine.model.Machine;
import com.smartlaundromat.machine.model.enums.CommProtocol;
import com.smartlaundromat.machine.model.enums.CycleType;
import com.smartlaundromat.machine.model.enums.MachineStatus;
import com.smartlaundromat.machine.model.enums.MachineType;
import com.smartlaundromat.machine.modbus.ModbusClient;
import com.smartlaundromat.machine.modbus.ModbusProperties;
import com.smartlaundromat.machine.mqtt.MqttService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class RealMachineCommandDispatcherTest {

    @Mock EqLinkClient eqLinkClient;
    @Mock EqLinkProperties eqLinkProperties;
    @Mock ModbusClient modbusClient;
    @Mock ModbusProperties modbusProperties;
    @Mock MqttService mqttService;

    @InjectMocks RealMachineCommandDispatcher dispatcher;

    private Machine modbusMachine;
    private Machine eqLinkMachine;
    private Machine mqttMachine;
    private MachineStartRequest request;

    @BeforeEach
    void setUp() {
        modbusMachine = Machine.builder()
                .machineId("washer_01").type(MachineType.WASHER)
                .status(MachineStatus.IDLE).commProtocol(CommProtocol.MODBUS).build();
        eqLinkMachine = Machine.builder()
                .machineId("washer_07").type(MachineType.WASHER)
                .status(MachineStatus.IDLE).commProtocol(CommProtocol.EQLINK).build();
        mqttMachine = Machine.builder()
                .machineId("washer_10").type(MachineType.WASHER)
                .status(MachineStatus.IDLE).commProtocol(CommProtocol.MQTT).build();

        request = new MachineStartRequest("washer_01", "NORMAL", 30, 2, null, null, null);
    }

    // ── Modbus ─────────────────────────────────────────────────────────────────

    @Nested
    class ModbusMachines {

        @Test
        void shouldDispatchViaModbusAndMqttWhenEnabled() {
            when(modbusProperties.isEnabled()).thenReturn(true);
            when(modbusClient.startMachine("washer_01", 2, 2)).thenReturn(true);

            dispatcher.dispatch(modbusMachine, request, CycleType.NORMAL);

            verify(modbusClient).startMachine("washer_01", 2, 2);
            verify(mqttService).sendCommand("washer_01", "pulse", 2);
            verifyNoInteractions(eqLinkClient);
        }

        @Test
        void shouldStillSendMqttWhenModbusDoesNotAck() {
            when(modbusProperties.isEnabled()).thenReturn(true);
            when(modbusClient.startMachine("washer_01", 2, 2)).thenReturn(false);

            dispatcher.dispatch(modbusMachine, request, CycleType.NORMAL);

            verify(mqttService).sendCommand("washer_01", "pulse", 2);
        }

        @Test
        void shouldFallThroughToMqttWhenModbusDisabled() {
            when(modbusProperties.isEnabled()).thenReturn(false);
            lenient().when(eqLinkProperties.isEnabled()).thenReturn(false);

            dispatcher.dispatch(modbusMachine, request, CycleType.NORMAL);

            verifyNoInteractions(modbusClient);
            verify(mqttService).sendCommand("washer_01", "pulse", 2);
        }
    }

    // ── EQLink ─────────────────────────────────────────────────────────────────

    @Nested
    class EqLinkMachines {

        @BeforeEach
        void setUp() {
            request = new MachineStartRequest(
                    "washer_07", request.cycleType(), request.durationMinutes(), request.pulseCount(),
                    request.transactionReference(), request.reservationCode(), request.rfidCardUid());
            lenient().when(modbusProperties.isEnabled()).thenReturn(false);
        }

        @Test
        void shouldDispatchViaEqLinkWhenEnabled() {
            when(eqLinkProperties.isEnabled()).thenReturn(true);
            when(eqLinkProperties.resolveDeviceName("washer_07")).thenReturn(Optional.of("SIM_EQLINK_WA07"));
            when(eqLinkProperties.getDefaultVendPrice()).thenReturn(10);

            EqDeviceInfo deviceInfo = new EqDeviceInfo();
            deviceInfo.setVendPrice(15);
            EqCheckStatusResponse statusResp = new EqCheckStatusResponse();
            statusResp.setStatus(200);
            statusResp.setDeviceStatus(deviceInfo);
            when(eqLinkClient.checkDeviceStatus("SIM_EQLINK_WA07")).thenReturn(statusResp);

            EqStartDeviceResponse startResp = new EqStartDeviceResponse();
            startResp.setStatus(200);
            when(eqLinkClient.startDeviceIot("SIM_EQLINK_WA07", 2, 15)).thenReturn(startResp);

            dispatcher.dispatch(eqLinkMachine, request, CycleType.NORMAL);

            verify(eqLinkClient).checkDeviceStatus("SIM_EQLINK_WA07");
            verify(eqLinkClient).startDeviceIot("SIM_EQLINK_WA07", 2, 15);
            verify(mqttService).sendCommand("washer_07", "pulse", 2); // safety net always fires
        }

        @Test
        void shouldFallbackToMqttOnEqLinkIotTimeout() {
            when(eqLinkProperties.isEnabled()).thenReturn(true);
            when(eqLinkProperties.resolveDeviceName("washer_07")).thenReturn(Optional.of("SIM_EQLINK_WA07"));
            when(eqLinkProperties.getDefaultVendPrice()).thenReturn(10);

            EqCheckStatusResponse statusResp = new EqCheckStatusResponse();
            statusResp.setStatus(200);
            when(eqLinkClient.checkDeviceStatus("SIM_EQLINK_WA07")).thenReturn(statusResp);

            EqStartDeviceResponse startResp = new EqStartDeviceResponse();
            startResp.setStatus(406); // IoT timeout
            when(eqLinkClient.startDeviceIot(any(), anyInt(), anyInt())).thenReturn(startResp);

            dispatcher.dispatch(eqLinkMachine, request, CycleType.NORMAL);

            verify(mqttService).sendCommand("washer_07", "pulse", 2);
        }

        @Test
        void shouldFallbackToMqttWhenNoDeviceNameMapping() {
            when(eqLinkProperties.isEnabled()).thenReturn(true);
            when(eqLinkProperties.resolveDeviceName("washer_07")).thenReturn(Optional.empty());

            dispatcher.dispatch(eqLinkMachine, request, CycleType.NORMAL);

            verifyNoInteractions(eqLinkClient);
            verify(mqttService).sendCommand("washer_07", "pulse", 2);
        }

        @Test
        void shouldUseMqttOnlyWhenEqLinkDisabled() {
            when(eqLinkProperties.isEnabled()).thenReturn(false);

            dispatcher.dispatch(eqLinkMachine, request, CycleType.NORMAL);

            verifyNoInteractions(eqLinkClient);
            verify(mqttService).sendCommand("washer_07", "pulse", 2);
        }
    }

    // ── MQTT fallback ──────────────────────────────────────────────────────────

    @Test
    void shouldDispatchViaMqttOnlyForMqttMachine() {
        lenient().when(modbusProperties.isEnabled()).thenReturn(false);
        lenient().when(eqLinkProperties.isEnabled()).thenReturn(false);
        request = new MachineStartRequest(
                "washer_10", request.cycleType(), request.durationMinutes(), request.pulseCount(),
                request.transactionReference(), request.reservationCode(), request.rfidCardUid());

        dispatcher.dispatch(mqttMachine, request, CycleType.NORMAL);

        verifyNoInteractions(modbusClient);
        verifyNoInteractions(eqLinkClient);
        verify(mqttService).sendCommand("washer_10", "pulse", 2);
    }

    // ── Modbus program mapping ─────────────────────────────────────────────────

    @ParameterizedTest
    @CsvSource({
            "QUICK,     1",
            "DELICATE,  1",
            "LOW_HEAT,  1",
            "COTTON_40, 1",
            "HEAVY,     3",
            "SANITIZE,  3",
            "HIGH_HEAT, 3",
            "COTTON_90, 3",
            "NORMAL,    2",
            "COTTON_60, 2",
    })
    void shouldMapCycleTypeToModbusProgram(String cycleType, int expectedProgram) {
        int actual = RealMachineCommandDispatcher.modbusProgramFor(CycleType.valueOf(cycleType));
        assertThat(actual).isEqualTo(expectedProgram);
    }
}
