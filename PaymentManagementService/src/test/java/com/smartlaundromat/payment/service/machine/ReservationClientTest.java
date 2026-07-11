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

import java.time.LocalDateTime;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
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

    @Test
    void shouldReturnEmptyWhenNoConflict() {
        when(restTemplate.getForObject(
                eq("http://localhost:8082/api/reservations/conflicts?machineId=MACH-01&durationMinutes=60"), eq(Map.class)))
                .thenReturn(Map.of("conflict", false));

        assertThat(client.checkConflict("MACH-01", 60, null)).isEmpty();
    }

    @Test
    void shouldReturnConflictingSlotStartWhenConflictExists() {
        when(restTemplate.getForObject(
                eq("http://localhost:8082/api/reservations/conflicts?machineId=MACH-01&durationMinutes=60"), eq(Map.class)))
                .thenReturn(Map.of("conflict", true, "conflictingSlotStart", "2026-06-11T10:00:00"));

        assertThat(client.checkConflict("MACH-01", 60, null))
                .contains(LocalDateTime.parse("2026-06-11T10:00:00"));
    }

    @Test
    void shouldIncludeReservationCodeInQueryWhenProvided() {
        when(restTemplate.getForObject(
                eq("http://localhost:8082/api/reservations/conflicts?machineId=MACH-01&durationMinutes=60&reservationCode=RES-ABC123"), eq(Map.class)))
                .thenReturn(Map.of("conflict", false));

        assertThat(client.checkConflict("MACH-01", 60, "RES-ABC123")).isEmpty();
    }

    @Test
    void shouldThrowWhenConflictReportedButSlotStartMissing() {
        // A malformed "conflict=true, no slotStart" response must fail closed, not be
        // silently treated as "no conflict".
        when(restTemplate.getForObject(
                eq("http://localhost:8082/api/reservations/conflicts?machineId=MACH-01&durationMinutes=60"), eq(Map.class)))
                .thenReturn(Map.of("conflict", true));

        assertThatThrownBy(() -> client.checkConflict("MACH-01", 60, null))
                .isInstanceOf(PaymentException.class)
                .hasMessageContaining("slot details were missing");
    }

    @Test
    void shouldThrowReservationStatusUnknownWhenConflictCheckFails() {
        when(restTemplate.getForObject(anyString(), eq(Map.class)))
                .thenThrow(new RuntimeException("Connection refused"));

        assertThatThrownBy(() -> client.checkConflict("MACH-01", 60, null))
                .isInstanceOf(PaymentException.class)
                .hasMessageContaining("Could not verify reservation availability");
    }
}
