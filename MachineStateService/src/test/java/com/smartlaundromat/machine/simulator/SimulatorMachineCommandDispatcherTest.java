package com.smartlaundromat.machine.simulator;

import com.smartlaundromat.machine.dto.StartCycleRequest;
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

        StartCycleRequest request = new StartCycleRequest();
        request.setMachineId("washer_01");
        request.setCycleType("NORMAL");
        request.setDurationMinutes(30);
        request.setPulseCount(2);

        assertThatCode(() -> dispatcher.dispatch(machine, request, CycleType.NORMAL))
                .doesNotThrowAnyException();
    }
}
