package com.smartlaundromat.machine.simulator;

import com.smartlaundromat.machine.dto.StartCycleRequest;
import com.smartlaundromat.machine.model.Machine;
import com.smartlaundromat.machine.model.enums.CycleType;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Component;

/**
 * No-op command dispatcher active when {@code simulator.enabled=true}.
 * <p>
 * The machine is already marked RUNNING in the DB before this is called.
 * {@link com.smartlaundromat.machine.service.CycleMonitorService} handles the
 * RUNNING → FINISHED transition when {@code cycleEndsAt} passes, so no hardware
 * call is needed.
 */
@Primary
@Component
@Slf4j
@ConditionalOnProperty(name = "simulator.enabled", havingValue = "true")
public class SimulatorMachineCommandDispatcher implements MachineCommandDispatcher {

    @Override
    public void dispatch(Machine machine, StartCycleRequest request, CycleType cycleType) {
        log.info("[SIMULATOR] Skipping hardware dispatch for machine={} cycleType={} duration={}min",
                machine.getMachineId(), cycleType, request.getDurationMinutes());
    }
}
