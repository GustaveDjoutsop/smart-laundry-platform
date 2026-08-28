package com.botmanager.core.machine;

import com.botmanager.bots.laundry.CycleConfig;
import com.botmanager.bots.laundry.LaundryBotConfig;
import com.botmanager.core.payment.PaymentEventPublisher;
import com.botmanager.core.payment.PaymentRecord;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.smartlaundromat.contracts.machine.MachineStartRequest;
import com.smartlaundromat.contracts.reservation.ReservationResponse;
import io.github.resilience4j.bulkhead.BulkheadRegistry;
import io.github.resilience4j.circuitbreaker.CircuitBreakerRegistry;
import io.github.resilience4j.retry.RetryRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import reactor.core.publisher.Mono;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class MachineServiceTest {

    @Mock
    MachineStore machineStore;

    @Mock
    WebClient webClient;

    @Mock
    WebClient.RequestHeadersUriSpec requestHeadersUriSpec;

    @Mock
    WebClient.RequestHeadersSpec requestHeadersSpec;

    @Mock
    WebClient.RequestBodyUriSpec requestBodyUriSpec;

    @Mock
    WebClient.RequestBodySpec requestBodySpec;

    @Mock
    WebClient.ResponseSpec responseSpec;

    ObjectMapper objectMapper;

    MachineService machineService;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        machineService = new MachineService(machineStore, objectMapper,
                CircuitBreakerRegistry.ofDefaults(), BulkheadRegistry.ofDefaults(), RetryRegistry.ofDefaults());
        ReflectionTestUtils.setField(machineService, "webClient", webClient);
        ReflectionTestUtils.setField(machineService, "machineStateServiceUrl", "http://localhost:8082");
    }

    @Nested
    class RegisterBot {

        @Test
        void shouldSeedMachinesOnRegister() {
            // given
            LaundryBotConfig config = new LaundryBotConfig();
            config.setBotId("test-bot");
            MachineConfig mc = new MachineConfig();
            mc.setId("w1");
            mc.setName("Washer 1");
            mc.setType(MachineType.WASHER);
            config.setMachines(List.of(mc));

            // when
            machineService.registerBot(config);

            // then
            verify(machineStore).upsertMachine(any(MachineRecord.class));
        }

        @Test
        void shouldSkipWhenMachinesNull() {
            // given
            LaundryBotConfig config = new LaundryBotConfig();
            config.setBotId("test-bot");
            config.setMachines(null);

            // when
            machineService.registerBot(config);

            // then
            verify(machineStore, never()).upsertMachine(any());
        }

        @Test
        void shouldSkipWhenMachinesEmpty() {
            // given
            LaundryBotConfig config = new LaundryBotConfig();
            config.setBotId("test-bot");
            config.setMachines(List.of());

            // when
            machineService.registerBot(config);

            // then
            verify(machineStore, never()).upsertMachine(any());
        }
    }

    @Nested
    class GetMachines {

        @SuppressWarnings("unchecked")
        @Test
        void shouldReturnMachinesFromService() {
            // given
            Map<String, Object> machineData = new HashMap<>();
            machineData.put("machineId", "w1");
            machineData.put("displayName", "Washer 1");
            machineData.put("status", "IDLE");
            machineData.put("available", true);
            machineData.put("type", "WASHER");

            Map<String, Object> response = new HashMap<>();
            response.put("machines", List.of(machineData));

            when(webClient.get()).thenReturn(requestHeadersUriSpec);
            when(requestHeadersUriSpec.uri(anyString())).thenReturn(requestHeadersSpec);
            when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
            when(responseSpec.bodyToMono(any(org.springframework.core.ParameterizedTypeReference.class)))
                    .thenReturn(Mono.just(response));

            // when
            List<MachineRecord> machines = machineService.getMachines("test-bot");

            // then
            assertThat(machines).hasSize(1);
            assertThat(machines.getFirst().getMachineId()).isEqualTo("w1");
            assertThat(machines.getFirst().getName()).isEqualTo("Washer 1");
            assertThat(machines.getFirst().getStatus()).isEqualTo(MachineStatus.AVAILABLE);
        }

        @SuppressWarnings("unchecked")
        @Test
        void shouldThrowWhenResponseIsNull() {
            // given
            when(webClient.get()).thenReturn(requestHeadersUriSpec);
            when(requestHeadersUriSpec.uri(anyString())).thenReturn(requestHeadersSpec);
            when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
            when(responseSpec.bodyToMono(any(org.springframework.core.ParameterizedTypeReference.class)))
                    .thenReturn(Mono.empty());

            // when / then
            assertThatThrownBy(() -> machineService.getMachines("test-bot"))
                    .isInstanceOf(MachineServiceUnavailableException.class);
        }

        @SuppressWarnings("unchecked")
        @Test
        void shouldThrowWhenWebClientFails() {
            // given
            when(webClient.get()).thenReturn(requestHeadersUriSpec);
            when(requestHeadersUriSpec.uri(anyString())).thenReturn(requestHeadersSpec);
            when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
            when(responseSpec.bodyToMono(any(org.springframework.core.ParameterizedTypeReference.class)))
                    .thenReturn(Mono.error(new RuntimeException("Connection refused")));

            // when / then
            assertThatThrownBy(() -> machineService.getMachines("test-bot"))
                    .isInstanceOf(MachineServiceUnavailableException.class);
        }

        @SuppressWarnings("unchecked")
        @Test
        void shouldMapRunningStatusToInUse() {
            // given
            Map<String, Object> machineData = new HashMap<>();
            machineData.put("machineId", "w1");
            machineData.put("displayName", "Washer 1");
            machineData.put("status", "RUNNING");
            machineData.put("available", false);
            machineData.put("remainingMinutes", 20);

            Map<String, Object> response = new HashMap<>();
            response.put("machines", List.of(machineData));

            when(webClient.get()).thenReturn(requestHeadersUriSpec);
            when(requestHeadersUriSpec.uri(anyString())).thenReturn(requestHeadersSpec);
            when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
            when(responseSpec.bodyToMono(any(org.springframework.core.ParameterizedTypeReference.class)))
                    .thenReturn(Mono.just(response));

            // when
            List<MachineRecord> machines = machineService.getMachines("test-bot");

            // then
            assertThat(machines.getFirst().getStatus()).isEqualTo(MachineStatus.IN_USE);
            assertThat(machines.getFirst().getRemainingSeconds()).isEqualTo(1200);
        }

        @SuppressWarnings("unchecked")
        @Test
        void shouldMapFinishedStatusToCompleting() {
            // given
            Map<String, Object> machineData = new HashMap<>();
            machineData.put("machineId", "w1");
            machineData.put("status", "FINISHED");
            machineData.put("available", false);

            Map<String, Object> response = new HashMap<>();
            response.put("machines", List.of(machineData));

            when(webClient.get()).thenReturn(requestHeadersUriSpec);
            when(requestHeadersUriSpec.uri(anyString())).thenReturn(requestHeadersSpec);
            when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
            when(responseSpec.bodyToMono(any(org.springframework.core.ParameterizedTypeReference.class)))
                    .thenReturn(Mono.just(response));

            // when
            List<MachineRecord> machines = machineService.getMachines("test-bot");

            // then
            assertThat(machines.getFirst().getStatus()).isEqualTo(MachineStatus.COMPLETING);
        }

        @SuppressWarnings("unchecked")
        @Test
        void shouldMapErrorStatus() {
            // given
            Map<String, Object> machineData = new HashMap<>();
            machineData.put("machineId", "w1");
            machineData.put("status", "ERROR");
            machineData.put("available", false);

            Map<String, Object> response = new HashMap<>();
            response.put("machines", List.of(machineData));

            when(webClient.get()).thenReturn(requestHeadersUriSpec);
            when(requestHeadersUriSpec.uri(anyString())).thenReturn(requestHeadersSpec);
            when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
            when(responseSpec.bodyToMono(any(org.springframework.core.ParameterizedTypeReference.class)))
                    .thenReturn(Mono.just(response));

            // when
            List<MachineRecord> machines = machineService.getMachines("test-bot");

            // then
            assertThat(machines.getFirst().getStatus()).isEqualTo(MachineStatus.ERROR);
        }

        @SuppressWarnings("unchecked")
        @Test
        void shouldMapMaintenanceStatus() {
            // given
            Map<String, Object> machineData = new HashMap<>();
            machineData.put("machineId", "w1");
            machineData.put("status", "MAINTENANCE");
            machineData.put("available", false);

            Map<String, Object> response = new HashMap<>();
            response.put("machines", List.of(machineData));

            when(webClient.get()).thenReturn(requestHeadersUriSpec);
            when(requestHeadersUriSpec.uri(anyString())).thenReturn(requestHeadersSpec);
            when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
            when(responseSpec.bodyToMono(any(org.springframework.core.ParameterizedTypeReference.class)))
                    .thenReturn(Mono.just(response));

            // when
            List<MachineRecord> machines = machineService.getMachines("test-bot");

            // then
            assertThat(machines.getFirst().getStatus()).isEqualTo(MachineStatus.MAINTENANCE);
        }

        @SuppressWarnings("unchecked")
        @Test
        void shouldMapDryerType() {
            // given
            Map<String, Object> machineData = new HashMap<>();
            machineData.put("machineId", "d1");
            machineData.put("status", "IDLE");
            machineData.put("available", true);
            machineData.put("type", "DRYER");

            Map<String, Object> response = new HashMap<>();
            response.put("machines", List.of(machineData));

            when(webClient.get()).thenReturn(requestHeadersUriSpec);
            when(requestHeadersUriSpec.uri(anyString())).thenReturn(requestHeadersSpec);
            when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
            when(responseSpec.bodyToMono(any(org.springframework.core.ParameterizedTypeReference.class)))
                    .thenReturn(Mono.just(response));

            // when
            List<MachineRecord> machines = machineService.getMachines("test-bot");

            // then
            assertThat(machines.getFirst().getType()).isEqualTo(MachineType.DRYER);
        }

        @SuppressWarnings("unchecked")
        @Test
        void shouldUseMachineIdAsNameWhenDisplayNameNull() {
            // given
            Map<String, Object> machineData = new HashMap<>();
            machineData.put("machineId", "w1");
            machineData.put("displayName", null);
            machineData.put("status", "IDLE");
            machineData.put("available", true);

            Map<String, Object> response = new HashMap<>();
            response.put("machines", List.of(machineData));

            when(webClient.get()).thenReturn(requestHeadersUriSpec);
            when(requestHeadersUriSpec.uri(anyString())).thenReturn(requestHeadersSpec);
            when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
            when(responseSpec.bodyToMono(any(org.springframework.core.ParameterizedTypeReference.class)))
                    .thenReturn(Mono.just(response));

            // when
            List<MachineRecord> machines = machineService.getMachines("test-bot");

            // then
            assertThat(machines.getFirst().getName()).isEqualTo("w1");
        }
    }

    @Nested
    class GetMachine {

        @SuppressWarnings("unchecked")
        @Test
        void shouldReturnSingleMachine() {
            // given
            Map<String, Object> machineData = new HashMap<>();
            machineData.put("machineId", "w1");
            machineData.put("displayName", "Washer 1");
            machineData.put("status", "IDLE");
            machineData.put("available", true);

            when(webClient.get()).thenReturn(requestHeadersUriSpec);
            when(requestHeadersUriSpec.uri(anyString())).thenReturn(requestHeadersSpec);
            when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
            when(responseSpec.bodyToMono(any(org.springframework.core.ParameterizedTypeReference.class)))
                    .thenReturn(Mono.just(machineData));

            // when
            Optional<MachineRecord> result = machineService.getMachine("test-bot", "w1");

            // then
            assertThat(result).isPresent();
            assertThat(result.get().getMachineId()).isEqualTo("w1");
        }

        @SuppressWarnings("unchecked")
        @Test
        void shouldThrowWhenSingleMachineResponseNull() {
            // given
            when(webClient.get()).thenReturn(requestHeadersUriSpec);
            when(requestHeadersUriSpec.uri(anyString())).thenReturn(requestHeadersSpec);
            when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
            when(responseSpec.bodyToMono(any(org.springframework.core.ParameterizedTypeReference.class)))
                    .thenReturn(Mono.empty());

            // when / then
            assertThatThrownBy(() -> machineService.getMachine("test-bot", "w1"))
                    .isInstanceOf(MachineServiceUnavailableException.class);
        }

        @SuppressWarnings("unchecked")
        @Test
        void shouldThrowWhenSingleMachineCallFails() {
            // given
            when(webClient.get()).thenReturn(requestHeadersUriSpec);
            when(requestHeadersUriSpec.uri(anyString())).thenReturn(requestHeadersSpec);
            when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
            when(responseSpec.bodyToMono(any(org.springframework.core.ParameterizedTypeReference.class)))
                    .thenReturn(Mono.error(new RuntimeException("timeout")));

            // when / then
            assertThatThrownBy(() -> machineService.getMachine("test-bot", "w1"))
                    .isInstanceOf(MachineServiceUnavailableException.class);
        }
    }

    @Nested
    class GetAvailableMachines {

        @SuppressWarnings("unchecked")
        @Test
        void shouldFilterOnlyAvailableMachines() {
            // given
            Map<String, Object> available = new HashMap<>();
            available.put("machineId", "w1");
            available.put("available", true);
            available.put("status", "IDLE");

            Map<String, Object> inUse = new HashMap<>();
            inUse.put("machineId", "w2");
            inUse.put("available", false);
            inUse.put("status", "RUNNING");

            Map<String, Object> response = new HashMap<>();
            response.put("machines", List.of(available, inUse));

            when(webClient.get()).thenReturn(requestHeadersUriSpec);
            when(requestHeadersUriSpec.uri(anyString())).thenReturn(requestHeadersSpec);
            when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
            when(responseSpec.bodyToMono(any(org.springframework.core.ParameterizedTypeReference.class)))
                    .thenReturn(Mono.just(response));

            // when
            List<MachineRecord> result = machineService.getAvailableMachines("test-bot");

            // then
            assertThat(result).hasSize(1);
            assertThat(result.getFirst().getMachineId()).isEqualTo("w1");
        }
    }

    @Nested
    class OnPaymentCompleted {

        @SuppressWarnings("unchecked")
        @Test
        void shouldStartMachineOnPaymentCompleted() {
            // given
            // Register bot config first
            LaundryBotConfig config = new LaundryBotConfig();
            config.setBotId("test-bot");
            config.setShortCycle(new CycleConfig(30, 1000, 1));
            config.setLongCycle(new CycleConfig(60, 2000, 2));
            config.setMachines(List.of());
            machineService.registerBot(config);

            Map<String, Object> metadata = new HashMap<>();
            metadata.put("machineId", "w1");
            metadata.put("program", "NORMAL");

            PaymentRecord record = PaymentRecord.builder()
                    .botId("test-bot")
                    .transactionId("txn-1")
                    .metadata(metadata)
                    .build();

            // Mock WebClient for startMachine
            when(webClient.post()).thenReturn(requestBodyUriSpec);
            when(requestBodyUriSpec.uri(anyString())).thenReturn(requestBodySpec);
            when(requestBodySpec.contentType(any())).thenReturn(requestBodySpec);
            when(requestBodySpec.bodyValue(any())).thenReturn(requestHeadersSpec);
            when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
            when(responseSpec.toBodilessEntity()).thenReturn(Mono.empty());

            PaymentEventPublisher.PaymentCompletedEvent event =
                    new PaymentEventPublisher.PaymentCompletedEvent(record);

            // when
            machineService.onPaymentCompleted(event);

            // then
            verify(webClient).post();
        }

        @Test
        void shouldSkipWhenMetadataIsNull() {
            // given
            PaymentRecord record = PaymentRecord.builder()
                    .botId("test-bot")
                    .transactionId("txn-1")
                    .metadata(null)
                    .build();

            PaymentEventPublisher.PaymentCompletedEvent event =
                    new PaymentEventPublisher.PaymentCompletedEvent(record);

            // when
            machineService.onPaymentCompleted(event);

            // then
            verify(webClient, never()).post();
        }

        @Test
        void shouldSkipWhenMachineIdIsNull() {
            // given
            Map<String, Object> metadata = new HashMap<>();
            metadata.put("program", "NORMAL");

            PaymentRecord record = PaymentRecord.builder()
                    .botId("test-bot")
                    .transactionId("txn-1")
                    .metadata(metadata)
                    .build();

            PaymentEventPublisher.PaymentCompletedEvent event =
                    new PaymentEventPublisher.PaymentCompletedEvent(record);

            // when
            machineService.onPaymentCompleted(event);

            // then
            verify(webClient, never()).post();
        }

        @Test
        void shouldForwardReservationCodeWhenPresentInMetadata() {
            // given
            Map<String, Object> metadata = new HashMap<>();
            metadata.put("machineId", "w1");
            metadata.put("program", "NORMAL");
            metadata.put("reservationCode", "RES-ABC123");

            PaymentRecord record = PaymentRecord.builder()
                    .botId("test-bot")
                    .transactionId("txn-1")
                    .metadata(metadata)
                    .build();

            when(webClient.post()).thenReturn(requestBodyUriSpec);
            when(requestBodyUriSpec.uri(anyString())).thenReturn(requestBodySpec);
            when(requestBodySpec.contentType(any())).thenReturn(requestBodySpec);
            ArgumentCaptor<MachineStartRequest> bodyCaptor = ArgumentCaptor.forClass(MachineStartRequest.class);
            when(requestBodySpec.bodyValue(bodyCaptor.capture())).thenReturn(requestHeadersSpec);
            when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
            when(responseSpec.toBodilessEntity()).thenReturn(Mono.empty());

            PaymentEventPublisher.PaymentCompletedEvent event =
                    new PaymentEventPublisher.PaymentCompletedEvent(record);

            // when
            machineService.onPaymentCompleted(event);

            // then
            assertThat(bodyCaptor.getValue().reservationCode()).isEqualTo("RES-ABC123");
        }

        @Test
        void shouldOmitReservationCodeWhenAbsentFromMetadata() {
            // given
            Map<String, Object> metadata = new HashMap<>();
            metadata.put("machineId", "w1");
            metadata.put("program", "NORMAL");

            PaymentRecord record = PaymentRecord.builder()
                    .botId("test-bot")
                    .transactionId("txn-1")
                    .metadata(metadata)
                    .build();

            when(webClient.post()).thenReturn(requestBodyUriSpec);
            when(requestBodyUriSpec.uri(anyString())).thenReturn(requestBodySpec);
            when(requestBodySpec.contentType(any())).thenReturn(requestBodySpec);
            ArgumentCaptor<MachineStartRequest> bodyCaptor = ArgumentCaptor.forClass(MachineStartRequest.class);
            when(requestBodySpec.bodyValue(bodyCaptor.capture())).thenReturn(requestHeadersSpec);
            when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
            when(responseSpec.toBodilessEntity()).thenReturn(Mono.empty());

            PaymentEventPublisher.PaymentCompletedEvent event =
                    new PaymentEventPublisher.PaymentCompletedEvent(record);

            // when
            machineService.onPaymentCompleted(event);

            // then
            assertThat(bodyCaptor.getValue().reservationCode()).isNull();
        }
    }

    @Nested
    class GetReservationByCode {

        @SuppressWarnings("unchecked")
        @Test
        void shouldReturnReservationOnSuccess() {
            // given
            ReservationResponse response = new ReservationResponse(
                    null, "w1", "Washer 1", null, null,
                    LocalDateTime.parse("2026-06-11T11:00:00"), null, null, null, null, null);

            when(webClient.get()).thenReturn(requestHeadersUriSpec);
            when(requestHeadersUriSpec.uri(anyString(), any(Object.class))).thenReturn(requestHeadersSpec);
            when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
            when(responseSpec.bodyToMono(any(org.springframework.core.ParameterizedTypeReference.class)))
                    .thenReturn(Mono.just(response));

            // when
            Optional<ReservationResponse> result = machineService.getReservationByCode("RES-ABC123");

            // then
            assertThat(result).contains(response);
            verify(requestHeadersUriSpec).uri("http://localhost:8082/api/reservations/{code}", "RES-ABC123");
        }

        @SuppressWarnings("unchecked")
        @Test
        void shouldReturnEmptyWhenCallFails() {
            // given
            when(webClient.get()).thenReturn(requestHeadersUriSpec);
            when(requestHeadersUriSpec.uri(anyString(), any(Object.class))).thenReturn(requestHeadersSpec);
            when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
            when(responseSpec.bodyToMono(any(org.springframework.core.ParameterizedTypeReference.class)))
                    .thenReturn(Mono.error(new RuntimeException("404 Not Found")));

            // when
            Optional<ReservationResponse> result = machineService.getReservationByCode("RES-UNKNOWN");

            // then
            assertThat(result).isEmpty();
        }
    }

    @Nested
    class GetHeldReservations {

        @SuppressWarnings("unchecked")
        @Test
        void shouldReturnHeldReservationsOnSuccess() {
            // given
            Map<String, Object> reservation = new HashMap<>();
            reservation.put("machineId", "w1");
            reservation.put("slotStart", "2026-06-11T16:00:00");
            List<Map<String, Object>> response = List.of(reservation);

            when(webClient.get()).thenReturn(requestHeadersUriSpec);
            when(requestHeadersUriSpec.uri(anyString(), any(Object.class))).thenReturn(requestHeadersSpec);
            when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
            when(responseSpec.bodyToMono(any(org.springframework.core.ParameterizedTypeReference.class)))
                    .thenReturn(Mono.just(response));

            // when
            List<Map<String, Object>> result = machineService.getHeldReservations("+237690000000");

            // then
            assertThat(result).isEqualTo(response);
            verify(requestHeadersUriSpec).uri("http://localhost:8082/api/reservations/customer/{phone}", "+237690000000");
        }

        @SuppressWarnings("unchecked")
        @Test
        void shouldReturnEmptyListWhenCallFails() {
            // given
            when(webClient.get()).thenReturn(requestHeadersUriSpec);
            when(requestHeadersUriSpec.uri(anyString(), any(Object.class))).thenReturn(requestHeadersSpec);
            when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
            when(responseSpec.bodyToMono(any(org.springframework.core.ParameterizedTypeReference.class)))
                    .thenReturn(Mono.error(new RuntimeException("Connection refused")));

            // when
            List<Map<String, Object>> result = machineService.getHeldReservations("+237690000000");

            // then
            assertThat(result).isEmpty();
        }
    }

    @Nested
    class ValidateReservation {

        @SuppressWarnings("unchecked")
        @Test
        void shouldReturnValidationResponseOnSuccess() {
            // given
            Map<String, Object> response = new HashMap<>();
            response.put("valid", true);

            when(webClient.post()).thenReturn(requestBodyUriSpec);
            when(requestBodyUriSpec.uri(anyString())).thenReturn(requestBodySpec);
            when(requestBodySpec.contentType(any())).thenReturn(requestBodySpec);
            when(requestBodySpec.bodyValue(any())).thenReturn(requestHeadersSpec);
            when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
            when(responseSpec.bodyToMono(any(org.springframework.core.ParameterizedTypeReference.class)))
                    .thenReturn(Mono.just(response));

            // when
            Optional<Map<String, Object>> result = machineService.validateReservation("RES-ABC123", "w1");

            // then
            assertThat(result).contains(response);
            verify(requestBodyUriSpec).uri("http://localhost:8082/api/reservations/validate");
        }

        @SuppressWarnings("unchecked")
        @Test
        void shouldReturnEmptyWhenCallFails() {
            // given
            when(webClient.post()).thenReturn(requestBodyUriSpec);
            when(requestBodyUriSpec.uri(anyString())).thenReturn(requestBodySpec);
            when(requestBodySpec.contentType(any())).thenReturn(requestBodySpec);
            when(requestBodySpec.bodyValue(any())).thenReturn(requestHeadersSpec);
            when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
            when(responseSpec.bodyToMono(any(org.springframework.core.ParameterizedTypeReference.class)))
                    .thenReturn(Mono.error(new RuntimeException("Connection refused")));

            // when
            Optional<Map<String, Object>> result = machineService.validateReservation("RES-ABC123", "w1");

            // then
            assertThat(result).isEmpty();
        }
    }

    @Nested
    class CancelReservation {

        @SuppressWarnings("unchecked")
        @Test
        void shouldReturnResponseOnSuccessfulCancel() {
            // given
            Map<String, Object> response = new HashMap<>();
            response.put("status", "CANCELLED");

            when(webClient.post()).thenReturn(requestBodyUriSpec);
            when(requestBodyUriSpec.uri(anyString())).thenReturn(requestBodySpec);
            when(requestBodySpec.contentType(any())).thenReturn(requestBodySpec);
            when(requestBodySpec.bodyValue(any())).thenReturn(requestHeadersSpec);
            when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
            when(responseSpec.bodyToMono(any(org.springframework.core.ParameterizedTypeReference.class)))
                    .thenReturn(Mono.just(response));

            // when
            Map<String, Object> result = machineService.cancelReservation("ref-1");

            // then
            assertThat(result).isEqualTo(response);
            verify(requestBodyUriSpec).uri("http://localhost:8082/api/reservations/cancel");
        }

        @SuppressWarnings("unchecked")
        @Test
        void shouldReturnNullWhenCallFails() {
            // given
            when(webClient.post()).thenReturn(requestBodyUriSpec);
            when(requestBodyUriSpec.uri(anyString())).thenReturn(requestBodySpec);
            when(requestBodySpec.contentType(any())).thenReturn(requestBodySpec);
            when(requestBodySpec.bodyValue(any())).thenReturn(requestHeadersSpec);
            when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
            when(responseSpec.bodyToMono(any(org.springframework.core.ParameterizedTypeReference.class)))
                    .thenReturn(Mono.error(new RuntimeException("Connection refused")));

            // when
            Map<String, Object> result = machineService.cancelReservation("ref-1");

            // then
            assertThat(result).isNull();
        }
    }

    @Nested
    class CreateReservation {

        @SuppressWarnings("unchecked")
        @Test
        void shouldReturnResponseOnSuccessfulCreate() {
            // given
            ReservationResponse response = new ReservationResponse(
                    "RES-ABC123", null, null, null, null, null, null, null, null, null, null);

            when(webClient.post()).thenReturn(requestBodyUriSpec);
            when(requestBodyUriSpec.uri(anyString())).thenReturn(requestBodySpec);
            when(requestBodySpec.contentType(any())).thenReturn(requestBodySpec);
            when(requestBodySpec.bodyValue(any())).thenReturn(requestHeadersSpec);
            when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
            when(responseSpec.bodyToMono(any(org.springframework.core.ParameterizedTypeReference.class)))
                    .thenReturn(Mono.just(response));

            // when
            ReservationResponse result = machineService.createReservation("w1", "+237690000000", "2026-06-11T10:00:00");

            // then
            assertThat(result).isEqualTo(response);
            verify(requestBodyUriSpec).uri("http://localhost:8082/api/reservations");
        }

        @SuppressWarnings("unchecked")
        @Test
        void shouldThrowServiceUnavailableOnEmptySuccessBody() {
            // given — an empty 2xx body is not a genuine conflict; it must not be conflated
            // with the null-means-conflict signal used elsewhere in this method.
            when(webClient.post()).thenReturn(requestBodyUriSpec);
            when(requestBodyUriSpec.uri(anyString())).thenReturn(requestBodySpec);
            when(requestBodySpec.contentType(any())).thenReturn(requestBodySpec);
            when(requestBodySpec.bodyValue(any())).thenReturn(requestHeadersSpec);
            when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
            when(responseSpec.bodyToMono(any(org.springframework.core.ParameterizedTypeReference.class)))
                    .thenReturn(Mono.empty());

            // when / then
            assertThatThrownBy(() -> machineService.createReservation("w1", "+237690000000", "2026-06-11T10:00:00"))
                    .isInstanceOf(MachineServiceUnavailableException.class);
        }

        @SuppressWarnings("unchecked")
        @Test
        void shouldReturnNullOnGenuineSlotConflict() {
            // given — MachineStateService returns 409 Conflict for an actual overlapping
            // reservation/cycle; this is the one failure mode that should NOT be escalated.
            when(webClient.post()).thenReturn(requestBodyUriSpec);
            when(requestBodyUriSpec.uri(anyString())).thenReturn(requestBodySpec);
            when(requestBodySpec.contentType(any())).thenReturn(requestBodySpec);
            when(requestBodySpec.bodyValue(any())).thenReturn(requestHeadersSpec);
            when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
            when(responseSpec.bodyToMono(any(org.springframework.core.ParameterizedTypeReference.class)))
                    .thenReturn(Mono.error(WebClientResponseException.create(
                            409, "Conflict", org.springframework.http.HttpHeaders.EMPTY, new byte[0], null)));

            // when
            ReservationResponse result = machineService.createReservation("w1", "+237690000000", "2026-06-11T10:00:00");

            // then
            assertThat(result).isNull();
        }

        @SuppressWarnings("unchecked")
        @Test
        void shouldThrowServiceUnavailableOnForbidden() {
            // given — e.g. the bot's M2M client is missing the required OAuth2 scope. This is
            // NOT a slot conflict and must not be silently treated as one.
            when(webClient.post()).thenReturn(requestBodyUriSpec);
            when(requestBodyUriSpec.uri(anyString())).thenReturn(requestBodySpec);
            when(requestBodySpec.contentType(any())).thenReturn(requestBodySpec);
            when(requestBodySpec.bodyValue(any())).thenReturn(requestHeadersSpec);
            when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
            when(responseSpec.bodyToMono(any(org.springframework.core.ParameterizedTypeReference.class)))
                    .thenReturn(Mono.error(WebClientResponseException.create(
                            403, "Forbidden", org.springframework.http.HttpHeaders.EMPTY, new byte[0], null)));

            // when / then
            assertThatThrownBy(() -> machineService.createReservation("w1", "+237690000000", "2026-06-11T10:00:00"))
                    .isInstanceOf(MachineServiceUnavailableException.class);
        }

        @SuppressWarnings("unchecked")
        @Test
        void shouldThrowServiceUnavailableOnGenericFailure() {
            // given — e.g. connection refused, timeout
            when(webClient.post()).thenReturn(requestBodyUriSpec);
            when(requestBodyUriSpec.uri(anyString())).thenReturn(requestBodySpec);
            when(requestBodySpec.contentType(any())).thenReturn(requestBodySpec);
            when(requestBodySpec.bodyValue(any())).thenReturn(requestHeadersSpec);
            when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
            when(responseSpec.bodyToMono(any(org.springframework.core.ParameterizedTypeReference.class)))
                    .thenReturn(Mono.error(new RuntimeException("Connection refused")));

            // when / then
            assertThatThrownBy(() -> machineService.createReservation("w1", "+237690000000", "2026-06-11T10:00:00"))
                    .isInstanceOf(MachineServiceUnavailableException.class);
        }
    }

    @Nested
    class MachineServiceUnavailableExceptionTest {

        @Test
        void shouldCreateWithMessage() {
            // given / when
            MachineServiceUnavailableException exception =
                    new MachineServiceUnavailableException("Service down");

            // then
            assertThat(exception.getMessage()).isEqualTo("Service down");
        }

        @Test
        void shouldCreateWithMessageAndCause() {
            // given
            RuntimeException cause = new RuntimeException("Connection refused");

            // when
            MachineServiceUnavailableException exception =
                    new MachineServiceUnavailableException("Service down", cause);

            // then
            assertThat(exception.getMessage()).isEqualTo("Service down");
            assertThat(exception.getCause()).isEqualTo(cause);
        }
    }
}
