package com.smartlaundromat.reporting;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class ReportingBffApplication {
    public static void main(String[] args) {
        // No-op touch to trigger a production redeploy (R10's CDN/asset
        // optimization work was merged but never promoted past dev) -- see docs/INFRASTRUCTURE.md.
        SpringApplication.run(ReportingBffApplication.class, args);
    }
}
