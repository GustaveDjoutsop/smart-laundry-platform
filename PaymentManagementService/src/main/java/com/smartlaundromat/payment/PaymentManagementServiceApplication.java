package com.smartlaundromat.payment;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class PaymentManagementServiceApplication {

    public static void main(String[] args) {
        SpringApplication.run(PaymentManagementServiceApplication.class, args);
    }
}
