package com.botmanager;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

@SpringBootTest
@ActiveProfiles("test")
@TestPropertySource(properties = {
    "spring.data.redis.url=redis://localhost:6379"
})
class SpringBotManagerApplicationTest {

    @Test
    void contextLoads() {
    }

}
