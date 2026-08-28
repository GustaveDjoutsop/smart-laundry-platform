package com.smartlaundromat.payment;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class PaymentManagementServiceApplication {

    public static void main(String[] args) {
        // No-op touch to trigger a production redeploy (R8's laundry-contracts
        // migration was merged but never promoted past dev) -- see docs/INFRASTRUCTURE.md.
        // Follow-up: auto-deploy was enabled here after #192's push, so it was missed.
        // Follow-up 2: #193's build failed (401 fetching laundry-contracts -- production
        // was missing GITHUB_PACKAGES_TOKEN, now added), retrying.
        SpringApplication.run(PaymentManagementServiceApplication.class, args);
    }
}
