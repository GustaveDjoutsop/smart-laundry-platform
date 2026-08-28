package com.botmanager;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableAsync
@EnableScheduling
public class SpringBotManagerApplication {

    public static void main(String[] args) {
        // No-op touch to trigger a production redeploy (R11's per-tenant rate
        // limiting was merged but never promoted past dev) -- see docs/INFRASTRUCTURE.md.
        // Follow-up: this service also depends on laundry-contracts (R11); production
        // was missing GITHUB_PACKAGES_TOKEN like MSS/PMS, now added -- retrying to be sure.
        SpringApplication.run(SpringBotManagerApplication.class, args);
    }

}
