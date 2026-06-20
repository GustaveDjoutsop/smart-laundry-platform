package com.botmanager.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

@Getter
@Setter
@ConfigurationProperties(prefix = "microservice")
public class MicroserviceProperties {

    private String paymentServiceUrl = "http://localhost:8081";

    private String machineStateServiceUrl = "http://localhost:8082";

}
