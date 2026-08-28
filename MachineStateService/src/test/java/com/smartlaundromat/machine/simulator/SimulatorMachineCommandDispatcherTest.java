package com.smartlaundromat.machine.simulator;

import com.smartlaundromat.contracts.machine.MachineStartRequest;
import com.smartlaundromat.machine.model.Machine;
import com.smartlaundromat.machine.model.enums.CommProtocol;
import com.smartlaundromat.machine.model.enums.CycleType;
import com.smartlaundromat.machine.model.enums.MachineStatus;
import com.smartlaundromat.machine.model.enums.MachineType;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThatCode;

class SimulatorMachineCommandDispatcherTest {

    private final SimulatorMachineCommandDispatcher dispatcher = new SimulatorMachineCommandDispatcher();

    @Test
    void shouldCompleteWithoutExceptionOrSideEffects() {
        Machine machine = Machine.builder()
                .machineId("washer_01")
                .type(MachineType.WASHER)
                .status(MachineStatus.IDLE)
                .commProtocol(CommProtocol.MODBUS)
                .build();

        MachineStartRequest request = new MachineStartRequest(
                "washer_01", "NORMAL", 30, 2, null, null, null);

        assertThatCode(() -> dispatcher.dispatch(machine, request, CycleType.NORMAL))
                .doesNotThrowAnyException();
    }
}
