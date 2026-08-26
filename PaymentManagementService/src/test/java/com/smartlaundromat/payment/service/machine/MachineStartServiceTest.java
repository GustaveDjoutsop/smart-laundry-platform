package com.smartlaundromat.payment.service.machine;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.smartlaundromat.contracts.machine.MachineStartRequest;
import com.smartlaundromat.payment.model.OutboxEvent;
import io.github.resilience4j.bulkhead.BulkheadRegistry;
import io.github.resilience4j.circuitbreaker.CircuitBreakerRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpEntity;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.client.RestTemplate;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class MachineStartServiceTest {

    @Mock
    RestTemplate restTemplate;

    MachineStartService machineStartService;

    private OutboxEvent validEvent;

    @BeforeEach
    void setUp() {
        machineStartService = new MachineStartService(
                restTemplate, new ObjectMapper(),
                CircuitBreakerRegistry.ofDefaults(), BulkheadRegistry.ofDefaults());
        ReflectionTestUtils.setField(machineStartService, "machineStateServiceUrl", "http://localhost:8082");

        validEvent = OutboxEvent.builder()
                .id(1L)
                .aggregateType("Transaction")
                .aggregateId("EXT-001")
                .eventType("PaymentSucceeded")
                .payload("{\"machineId\":\"MACH-01\",\"transactionReference\":\"EXT-001\","
                        + "\"cycleType\":\"NORMAL\",\"durationMinutes\":30,\"pulseCount\":2}")
                .build();
    }

    @Test
    void shouldPostStartCycleForValidEvent() throws Exception {
        when(restTemplate.postForEntity(anyString(), any(HttpEntity.class), eq(Map.class)))
                .thenReturn(ResponseEntity.ok(Map.of("status", "ok")));

        machineStartService.publish(validEvent);

        verify(restTemplate).postForEntity(
                eq("http://localhost:8082/api/machines/start-cycle"),
                any(HttpEntity.class),
                eq(Map.class));
    }

    @Test
    void shouldSkipAndNotThrowWhenMachineIdMissing() {
        OutboxEvent noMachineEvent = OutboxEvent.builder()
                .id(2L)
                .aggregateType("Transaction")
                .aggregateId("EXT-002")
                .eventType("PaymentSucceeded")
                .payload("{\"transactionReference\":\"EXT-002\",\"cycleType\":\"NORMAL\"}")
                .build();

        assertThatCode(() -> machineStartService.publish(noMachineEvent))
                .doesNotThrowAnyException();
        verifyNoInteractions(restTemplate);
    }

    @Test
    void shouldPropagateExceptionOnRestTemplateFailure() {
        when(restTemplate.postForEntity(anyString(), any(HttpEntity.class), eq(Map.class)))
                .thenThrow(new RuntimeException("Connection refused"));

        assertThatThrownBy(() -> machineStartService.publish(validEvent))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("Connection refused");
    }

    @SuppressWarnings("unchecked")
    @Test
    void shouldForwardReservationCodeWhenPresentInPayload() throws Exception {
        OutboxEvent reservationEvent = OutboxEvent.builder()
                .id(4L)
                .aggregateType("Transaction")
                .aggregateId("EXT-004")
                .eventType("PaymentSucceeded")
                .payload("{\"machineId\":\"MACH-01\",\"transactionReference\":\"EXT-004\","
                        + "\"cycleType\":\"NORMAL\",\"durationMinutes\":30,\"pulseCount\":2,"
                        + "\"reservationCode\":\"RES-ABC123\"}")
                .build();

        ArgumentCaptor<HttpEntity<MachineStartRequest>> captor = ArgumentCaptor.forClass(HttpEntity.class);
        when(restTemplate.postForEntity(anyString(), captor.capture(), eq(Map.class)))
                .thenReturn(ResponseEntity.ok(Map.of("status", "ok")));

        machineStartService.publish(reservationEvent);

        assertThat(captor.getValue().getBody().reservationCode()).isEqualTo("RES-ABC123");
    }

    @SuppressWarnings("unchecked")
    @Test
    void shouldOmitReservationCodeWhenAbsentFromPayload() throws Exception {
        ArgumentCaptor<HttpEntity<MachineStartRequest>> captor = ArgumentCaptor.forClass(HttpEntity.class);
        when(restTemplate.postForEntity(anyString(), captor.capture(), eq(Map.class)))
                .thenReturn(ResponseEntity.ok(Map.of("status", "ok")));

        machineStartService.publish(validEvent);

        assertThat(captor.getValue().getBody().reservationCode()).isNull();
    }

    @SuppressWarnings("unchecked")
    @Test
    void shouldMapPayloadFieldsOntoMachineStartRequest() throws Exception {
        // given
        ArgumentCaptor<HttpEntity<MachineStartRequest>> captor = ArgumentCaptor.forClass(HttpEntity.class);
        when(restTemplate.postForEntity(anyString(), captor.capture(), eq(Map.class)))
                .thenReturn(ResponseEntity.ok(Map.of("status", "ok")));

        // when
        machineStartService.publish(validEvent);

        // then
        MachineStartRequest body = captor.getValue().getBody();
        assertThat(body.machineId()).isEqualTo("MACH-01");
        assertThat(body.cycleType()).isEqualTo("NORMAL");
        assertThat(body.durationMinutes()).isEqualTo(30);
        assertThat(body.pulseCount()).isEqualTo(2);
        assertThat(body.transactionReference()).isEqualTo("EXT-001");
    }

    @SuppressWarnings("unchecked")
    @Test
    void shouldApplyDefaultsWhenCycleTypeDurationAndPulseCountMissingFromPayload() throws Exception {
        // given
        OutboxEvent minimalEvent = OutboxEvent.builder()
                .id(5L)
                .aggregateType("Transaction")
                .aggregateId("EXT-005")
                .eventType("PaymentSucceeded")
                .payload("{\"machineId\":\"MACH-02\",\"transactionReference\":\"EXT-005\"}")
                .build();

        ArgumentCaptor<HttpEntity<MachineStartRequest>> captor = ArgumentCaptor.forClass(HttpEntity.class);
        when(restTemplate.postForEntity(anyString(), captor.capture(), eq(Map.class)))
                .thenReturn(ResponseEntity.ok(Map.of("status", "ok")));

        // when
        machineStartService.publish(minimalEvent);

        // then
        MachineStartRequest body = captor.getValue().getBody();
        assertThat(body.cycleType()).isEqualTo("NORMAL");
        assertThat(body.durationMinutes()).isEqualTo(30);
        assertThat(body.pulseCount()).isEqualTo(1);
    }

    @Test
    void shouldThrowOnMalformedPayloadJson() {
        OutboxEvent badPayload = OutboxEvent.builder()
                .id(3L)
                .eventType("PaymentSucceeded")
                .payload("not-json{{{")
                .build();

        assertThatThrownBy(() -> machineStartService.publish(badPayload))
                .isInstanceOf(Exception.class);
        verifyNoInteractions(restTemplate);
    }
}
