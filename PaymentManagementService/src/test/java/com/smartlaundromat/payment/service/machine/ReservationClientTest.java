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
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class ReservationClientTest {

    @Mock
    RestTemplate restTemplate;

    ReservationClient client;

    @BeforeEach
    void setUp() {
        client = new ReservationClient(
                restTemplate, "http://localhost:8082",
                CircuitBreakerRegistry.ofDefaults(), BulkheadRegistry.ofDefaults());
        ReflectionTestUtils.setField(client, "machineStateServiceUrl", "http://localhost:8082");
    }

    @Test
    void shouldReturnTrueWhenCodeIsValid() {
        when(restTemplate.postForObject(eq("http://localhost:8082/api/reservations/validate"), any(), eq(Map.class)))
                .thenReturn(Map.of("valid", true));

        assertThat(client.isValid("RES-ABC123", "MACH-01")).isTrue();
    }

    @Test
    void shouldReturnFalseWhenCodeIsInvalid() {
        when(restTemplate.postForObject(eq("http://localhost:8082/api/reservations/validate"), any(), eq(Map.class)))
                .thenReturn(Map.of("valid", false, "reason", "USED"));

        assertThat(client.isValid("RES-ABC123", "MACH-01")).isFalse();
    }

    @Test
    void shouldThrowReservationStatusUnknownWhenServiceUnreachable() {
        when(restTemplate.postForObject(eq("http://localhost:8082/api/reservations/validate"), any(), eq(Map.class)))
                .thenThrow(new RuntimeException("Connection refused"));

        assertThatThrownBy(() -> client.isValid("RES-ABC123", "MACH-01"))
                .isInstanceOf(PaymentException.class)
                .hasMessageContaining("Could not verify reservation code");
    }
}
