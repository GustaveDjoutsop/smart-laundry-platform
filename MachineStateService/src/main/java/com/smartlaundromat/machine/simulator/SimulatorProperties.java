package com.smartlaundromat.machine.simulator;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Data
@Component
@ConfigurationProperties(prefix = "simulator")
public class SimulatorProperties {

    private boolean enabled = false;
    private long heartbeatIntervalMs = 5000;
    private long telemetryUpdateIntervalMs = 10000;
}
