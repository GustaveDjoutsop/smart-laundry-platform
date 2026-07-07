package com.smartlaundromat.payment.service.machine;

import com.smartlaundromat.payment.exception.PaymentException;
import io.github.resilience4j.bulkhead.BulkheadRegistry;
import io.github.resilience4j.circuitbreaker.CircuitBreakerRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.client.RestTemplate;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class MachineAvailabilityClientTest {

    @Mock
    RestTemplate restTemplate;

    MachineAvailabilityClient client;

    @BeforeEach
    void setUp() {
        client = new MachineAvailabilityClient(
                restTemplate, "http://localhost:8082",
                CircuitBreakerRegistry.ofDefaults(), BulkheadRegistry.ofDefaults());
        ReflectionTestUtils.setField(client, "machineStateServiceUrl", "http://localhost:8082");
    }

    @Test
    void shouldReturnTrueWhenMachineIsAvailable() {
        when(restTemplate.getForObject(eq("http://localhost:8082/api/machines/MACH-01"), eq(Map.class)))
                .thenReturn(Map.of("machineId", "MACH-01", "available", true));

        assertThat(client.isAvailable("MACH-01")).isTrue();
    }

    @Test
    void shouldReturnFalseWhenMachineIsNotAvailable() {
        when(restTemplate.getForObject(eq("http://localhost:8082/api/machines/MACH-01"), eq(Map.class)))
                .thenReturn(Map.of("machineId", "MACH-01", "available", false));

        assertThat(client.isAvailable("MACH-01")).isFalse();
    }

    @Test
    void shouldThrowMachineStatusUnknownWhenServiceUnreachable() {
        when(restTemplate.getForObject(eq("http://localhost:8082/api/machines/MACH-01"), eq(Map.class)))
                .thenThrow(new RuntimeException("Connection refused"));

        assertThatThrownBy(() -> client.isAvailable("MACH-01"))
                .isInstanceOf(PaymentException.class)
                .hasMessageContaining("Could not verify status");
    }
}
