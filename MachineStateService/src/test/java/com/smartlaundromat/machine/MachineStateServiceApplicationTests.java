package com.smartlaundromat.machine;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestPropertySource;

@SpringBootTest
@TestPropertySource(properties = {
        "mqtt.broker-url=tcp://localhost:1883"
})
class MachineStateServiceApplicationTests {

    @Test
    void contextLoads() {
    }
}
