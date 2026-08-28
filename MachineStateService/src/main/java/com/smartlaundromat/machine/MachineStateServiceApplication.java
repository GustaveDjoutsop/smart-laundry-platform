package com.smartlaundromat.machine;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class MachineStateServiceApplication {

    public static void main(String[] args) {
        // No-op touch to trigger a production redeploy (R8's laundry-contracts
        // migration was merged but never promoted past dev) -- see docs/INFRASTRUCTURE.md.
        // Follow-up: auto-deploy was enabled here after #192's push, so it was missed.
        SpringApplication.run(MachineStateServiceApplication.class, args);
    }
}
