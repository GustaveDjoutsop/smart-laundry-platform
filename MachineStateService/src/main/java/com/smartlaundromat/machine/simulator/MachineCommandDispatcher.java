package com.smartlaundromat.machine.simulator;

import com.smartlaundromat.machine.dto.StartCycleRequest;
import com.smartlaundromat.machine.model.Machine;
import com.smartlaundromat.machine.model.enums.CycleType;

/**
 * Abstraction over the hardware-level start command.
 * <p>
 * In production: {@link RealMachineCommandDispatcher} — routes via EQLink / Modbus / MQTT.
 * In dev/simulator mode: {@link SimulatorMachineCommandDispatcher} — no-op, DB state drives
 * the cycle lifecycle instead.
 */
public interface MachineCommandDispatcher {

    void dispatch(Machine machine, StartCycleRequest request, CycleType cycleType);
}
