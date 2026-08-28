package com.botmanager.core.machine;

import com.botmanager.bots.laundry.LaundryBotConfig;
import com.botmanager.core.payment.PaymentEventPublisher;
import com.botmanager.core.payment.PaymentRecord;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.smartlaundromat.contracts.machine.MachineStartRequest;
import com.smartlaundromat.contracts.reservation.ReservationRequest;
import com.smartlaundromat.contracts.reservation.ReservationResponse;
import io.github.resilience4j.bulkhead.Bulkhead;
import io.github.resilience4j.bulkhead.BulkheadRegistry;
import io.github.resilience4j.circuitbreaker.CircuitBreaker;
import io.github.resilience4j.circuitbreaker.CircuitBreakerRegistry;
import io.github.resilience4j.retry.Retry;
import io.github.resilience4j.retry.RetryRegistry;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.event.EventListener;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;

import java.time.Instant;
import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Supplier;

@Slf4j
@Service
@RequiredArgsConstructor
public class MachineService {

    private final MachineStore machineStore;

    private final ObjectMapper objectMapper;

    @Autowired
    @Qualifier("microserviceWebClient")
    private WebClient webClient;

    private final CircuitBreakerRegistry circuitBreakerRegistry;

    private final BulkheadRegistry bulkheadRegistry;

    private final RetryRegistry retryRegistry;

    @Value("${microservice.machine-state-service-url:http://localhost:8082}")
    private String machineStateServiceUrl;

    private <T> T callMachineService(Supplier<T> call) {
        Supplier<T> decorated = Bulkhead.decorateSupplier(
                bulkheadRegistry.bulkhead("machineService"), call);
        decorated = CircuitBreaker.decorateSupplier(
                circuitBreakerRegistry.circuitBreaker("machineService"), decorated);
        return decorated.get();
    }

    private <T> T callMachineServiceRead(Supplier<T> call) {
        Supplier<T> decorated = Bulkhead.decorateSupplier(
                bulkheadRegistry.bulkhead("machineService"), call);
        decorated = CircuitBreaker.decorateSupplier(
                circuitBreakerRegistry.circuitBreaker("machineService"), decorated);
        decorated = Retry.decorateSupplier(
                retryRegistry.retry("machineServiceRead"), decorated);
        return decorated.get();
    }

    private final Map<String, LaundryBotConfig> botConfigs = new ConcurrentHashMap<>();

    public void registerBot(LaundryBotConfig botConfig) {
        if (botConfig.getMachines() == null || botConfig.getMachines().isEmpty()) {
            return;
        }
        botConfigs.put(botConfig.getBotId(), botConfig);
        seedMachines(botConfig);
        log.info("Registered {} machines for bot {}", botConfig.getMachines().size(), botConfig.getBotId());
    }

    public List<MachineRecord> getMachines(String botId) {
        try {
            Map<String, Object> response = callMachineServiceRead(() -> webClient.get()
                    .uri(machineStateServiceUrl + "/api/machines")
                    .retrieve()
                    .bodyToMono(new ParameterizedTypeReference<Map<String, Object>>() {})
                    .block());

            if (response != null) {
                return mapMachineListFromResponse(botId, response);
            }
            throw new MachineServiceUnavailableException("MachineStateService returned empty response");
        } catch (MachineServiceUnavailableException e) {
            throw e;
        } catch (Exception exception) {
            log.warn("Failed to get machines from MachineStateService: {}", exception.getMessage());
            throw new MachineServiceUnavailableException("MachineStateService unreachable", exception);
        }
    }

    public Optional<MachineRecord> getMachine(String botId, String machineId) {
        try {
            Map<String, Object> response = callMachineServiceRead(() -> webClient.get()
                    .uri(machineStateServiceUrl + "/api/machines/" + machineId)
                    .retrieve()
                    .bodyToMono(new ParameterizedTypeReference<Map<String, Object>>() {})
                    .block());

            if (response != null) {
                return Optional.of(mapMachineFromResponse(botId, response));
            }
            throw new MachineServiceUnavailableException("MachineStateService returned empty response");
        } catch (MachineServiceUnavailableException e) {
            throw e;
        } catch (Exception exception) {
            log.warn("Failed to get machine {} from MachineStateService: {}", machineId, exception.getMessage());
            throw new MachineServiceUnavailableException("MachineStateService unreachable for machine " + machineId, exception);
        }
    }

    public List<MachineRecord> getAvailableMachines(String botId) {
        return getMachines(botId).stream()
                .filter(machine -> machine.getStatus() == MachineStatus.AVAILABLE)
                .toList();
    }

    public void startMachine(String botId, String machineId, String program, String transactionId) {
        startMachine(botId, machineId, program, transactionId, null);
    }

    public void startMachine(String botId, String machineId, String program, String transactionId,
                              String reservationCode) {
        try {
            MachineStartRequest body = new MachineStartRequest(
                    machineId,
                    program != null ? program : "NORMAL",
                    resolveDuration(botId, program),
                    resolvePulseCount(botId, program),
                    transactionId,
                    reservationCode,
                    null);

            callMachineService(() -> webClient.post()
                    .uri(machineStateServiceUrl + "/api/machines/start-cycle")
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(body)
                    .retrieve()
                    .toBodilessEntity()
                    .block());

            log.info("Sent start-cycle to MachineStateService: machine={}, program={}", machineId, program);
        } catch (Exception exception) {
            log.error("Failed to start machine {} via MachineStateService: {}", machineId, exception.getMessage());
        }
    }

    public void stopMachine(String botId, String machineId, String transactionId) {
        try {
            callMachineService(() -> webClient.post()
                    .uri(machineStateServiceUrl + "/api/machines/" + machineId + "/command/stop")
                    .retrieve()
                    .toBodilessEntity()
                    .block());
            log.info("Sent STOP command to machine {} via MachineStateService", machineId);
        } catch (Exception exception) {
            log.error("Failed to stop machine {}: {}", machineId, exception.getMessage());
        }
    }

    public void requestStatus(String botId, String machineId) {
        try {
            callMachineService(() -> webClient.post()
                    .uri(machineStateServiceUrl + "/api/machines/" + machineId + "/command/status")
                    .retrieve()
                    .toBodilessEntity()
                    .block());
        } catch (Exception exception) {
            log.warn("Failed to request status for machine {}: {}", machineId, exception.getMessage());
        }
    }

    /**
     * Creates a reservation via MachineStateService and returns the response containing
     * the reservation code and details.
     *
     * @return the reservation response, or null if the slot is genuinely already taken
     *         (MachineStateService returns 409 Conflict for this)
     * @throws MachineServiceUnavailableException on any other failure (auth, 5xx, timeout,
     *         connection refused, ...) — these are not slot conflicts and must not be reported
     *         to the customer as "someone else took your slot"
     */
    public ReservationResponse createReservation(String machineId, String customerPhone,
                                                  String slotStart) {
        try {
            ReservationRequest body = new ReservationRequest(
                    machineId, customerPhone, LocalDateTime.parse(slotStart));

            log.info("Creating reservation via MachineStateService: machineId={}, slotStart={}", machineId, slotStart);

            ReservationResponse response = callMachineService(() -> webClient.post()
                    .uri(machineStateServiceUrl + "/api/reservations")
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(body)
                    .retrieve()
                    .bodyToMono(new ParameterizedTypeReference<ReservationResponse>() {})
                    .block());

            if (response == null) {
                // An empty 2xx body is not a genuine conflict — never conflate it with one.
                throw new MachineServiceUnavailableException(
                        "MachineStateService returned empty response for reservation on machine " + machineId);
            }

            log.info("Reservation created successfully: {}", response);
            return response;
        } catch (MachineServiceUnavailableException e) {
            throw e;
        } catch (WebClientResponseException.Conflict conflict) {
            log.info("Reservation slot conflict for machine {}: {}", machineId, conflict.getMessage());
            return null;
        } catch (Exception exception) {
            log.warn("Failed to create reservation for machine {}: {}", machineId, exception.getMessage());
            throw new MachineServiceUnavailableException(
                    "Failed to create reservation for machine " + machineId, exception);
        }
    }

    /**
     * Activates a reservation via MachineStateService using the transaction reference.
     *
     * @return the activation response map, or null if the call failed
     */
    public Map<String, Object> activateReservation(String transactionReference) {
        try {
            Map<String, Object> body = new HashMap<>();
            body.put("transactionReference", transactionReference);

            log.info("Activating reservation via MachineStateService: transactionReference={}", transactionReference);

            Map<String, Object> response = callMachineService(() -> webClient.post()
                    .uri(machineStateServiceUrl + "/api/reservations/activate")
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(body)
                    .retrieve()
                    .bodyToMono(new ParameterizedTypeReference<Map<String, Object>>() {})
                    .block());

            log.info("Reservation activated successfully: {}", response);
            return response;
        } catch (Exception exception) {
            log.error("Failed to activate reservation with ref {}: {}", transactionReference, exception.getMessage());
            return null;
        }
    }

    /**
     * Cancels a not-yet-activated reservation via MachineStateService, releasing the
     * hold on the slot (e.g. when the reservation-fee payment fails or is never
     * initiated). Safe to call even if the reservation was never created.
     *
     * @return the cancellation response map, or null if the call failed
     */
    public Map<String, Object> cancelReservation(String transactionReference) {
        try {
            Map<String, Object> body = new HashMap<>();
            body.put("transactionReference", transactionReference);

            log.info("Cancelling reservation via MachineStateService: transactionReference={}", transactionReference);

            Map<String, Object> response = callMachineService(() -> webClient.post()
                    .uri(machineStateServiceUrl + "/api/reservations/cancel")
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(body)
                    .retrieve()
                    .bodyToMono(new ParameterizedTypeReference<Map<String, Object>>() {})
                    .block());

            log.info("Reservation cancelled successfully: {}", response);
            return response;
        } catch (Exception exception) {
            log.error("Failed to cancel reservation with ref {}: {}", transactionReference, exception.getMessage());
            return null;
        }
    }

    /**
     * Looks up a reservation by its redemption code. This is the only endpoint that maps
     * code → machine without already knowing the machine, so it's the first call in the
     * bot's "I have a reservation code" redemption flow.
     *
     * @return the reservation response, or empty if the code doesn't exist / the service is
     *         unreachable.
     */
    public Optional<ReservationResponse> getReservationByCode(String code) {
        try {
            // URI template variable (not string concatenation) so WebClient percent-encodes the
            // code — this method is public and must not assume callers have already sanitized it.
            ReservationResponse response = callMachineServiceRead(() -> webClient.get()
                    .uri(machineStateServiceUrl + "/api/reservations/{code}", code)
                    .retrieve()
                    .bodyToMono(new ParameterizedTypeReference<ReservationResponse>() {})
                    .block());

            return Optional.ofNullable(response);
        } catch (Exception exception) {
            log.warn("Failed to fetch reservation by code {}: {}", code, exception.getMessage());
            return Optional.empty();
        }
    }

    /**
     * Authoritative code + machine validity check (valid/reason), used both to confirm a
     * redemption before showing cycle selection and to pre-check before charging.
     *
     * @return the validation response map ({@code valid}, {@code reason}), or empty if the
     *         service is unreachable.
     */
    public Optional<Map<String, Object>> validateReservation(String reservationCode, String machineId) {
        try {
            Map<String, Object> body = new HashMap<>();
            body.put("reservationCode", reservationCode);
            body.put("machineId", machineId);

            Map<String, Object> response = callMachineServiceRead(() -> webClient.post()
                    .uri(machineStateServiceUrl + "/api/reservations/validate")
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(body)
                    .retrieve()
                    .bodyToMono(new ParameterizedTypeReference<Map<String, Object>>() {})
                    .block());

            return Optional.ofNullable(response);
        } catch (Exception exception) {
            log.warn("Failed to validate reservation code {} for machine {}: {}",
                    reservationCode, machineId, exception.getMessage());
            return Optional.empty();
        }
    }

    /**
     * A customer's currently-held reservations (paid-and-confirmed or awaiting fee
     * payment), soonest slot first — used by the status check so a held reservation
     * is never mistaken for a machine actually running right now.
     *
     * @return the held reservations, or an empty list if the service is unreachable
     */
    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> getHeldReservations(String customerPhone) {
        try {
            List<Map<String, Object>> response = callMachineServiceRead(() -> webClient.get()
                    .uri(machineStateServiceUrl + "/api/reservations/customer/{phone}", customerPhone)
                    .retrieve()
                    .bodyToMono(new ParameterizedTypeReference<List<Map<String, Object>>>() {})
                    .block());

            return response != null ? response : List.of();
        } catch (Exception exception) {
            log.warn("Failed to fetch held reservations for customerPhone={}: {}",
                    customerPhone, exception.getMessage());
            return List.of();
        }
    }

    @EventListener
    public void onPaymentCompleted(PaymentEventPublisher.PaymentCompletedEvent event) {
        PaymentRecord record = event.getRecord();
        if (record.getMetadata() == null) {
            return;
        }
        // Reservation payments are handled separately (see LaundryBot.handleReservationPaymentCompleted) —
        // the machine must not be started immediately, only at the reserved slot's start time.
        if (Boolean.TRUE.equals(record.getMetadata().get("isReservation"))) {
            return;
        }
        String machineId = (String) record.getMetadata().get("machineId");
        String program = (String) record.getMetadata().get("program");
        String reservationCode = (String) record.getMetadata().get("reservationCode");
        if (machineId != null) {
            startMachine(record.getBotId(), machineId,
                    program != null ? program : "NORMAL",
                    record.getTransactionId(),
                    reservationCode);
        }
    }

    private void seedMachines(LaundryBotConfig botConfig) {
        for (MachineConfig machineConfig : botConfig.getMachines()) {
            MachineRecord record = MachineRecord.builder()
                    .botId(botConfig.getBotId())
                    .machineId(machineConfig.getId())
                    .type(machineConfig.getType())
                    .name(machineConfig.getName())
                    .status(MachineStatus.AVAILABLE)
                    .build();
            machineStore.upsertMachine(record);
        }
    }

    @SuppressWarnings("unchecked")
    private List<MachineRecord> mapMachineListFromResponse(String botId, Map<String, Object> responseBody) {
        List<MachineRecord> records = new ArrayList<>();
        Object machinesObj = responseBody.get("machines");
        if (machinesObj instanceof List<?> machinesList) {
            for (Object item : machinesList) {
                if (item instanceof Map) {
                    records.add(mapMachineFromResponse(botId, (Map<String, Object>) item));
                }
            }
        }
        return records;
    }

    private MachineRecord mapMachineFromResponse(String botId, Map<String, Object> data) {
        String machineId = (String) data.get("machineId");
        String displayName = (String) data.get("displayName");
        String statusStr = (String) data.get("status");
        String typeStr = (String) data.get("type");
        Boolean available = (Boolean) data.get("available");
        Object remainingObj = data.get("remainingMinutes");
        Integer remainingMinutes = remainingObj instanceof Number ? ((Number) remainingObj).intValue() : null;

        MachineStatus status;
        if (Boolean.TRUE.equals(available)) {
            status = MachineStatus.AVAILABLE;
        } else if ("RUNNING".equalsIgnoreCase(statusStr)) {
            status = MachineStatus.IN_USE;
        } else if ("FINISHED".equalsIgnoreCase(statusStr)) {
            status = MachineStatus.COMPLETING;
        } else if ("ERROR".equalsIgnoreCase(statusStr)) {
            status = MachineStatus.ERROR;
        } else if ("MAINTENANCE".equalsIgnoreCase(statusStr)) {
            status = MachineStatus.MAINTENANCE;
        } else {
            status = MachineStatus.fromValue(statusStr);
        }

        MachineType type = null;
        if ("WASHER".equalsIgnoreCase(typeStr)) {
            type = MachineType.WASHER;
        } else if ("DRYER".equalsIgnoreCase(typeStr)) {
            type = MachineType.DRYER;
        }

        MachineRecord record = MachineRecord.builder()
                .botId(botId)
                .machineId(machineId)
                .type(type)
                .name(displayName != null ? displayName : machineId)
                .status(status)
                .remainingSeconds(remainingMinutes != null ? remainingMinutes * 60 : null)
                .lastHeartbeatAt(Instant.now())
                .build();

        machineStore.upsertMachine(record);
        return record;
    }

    private int resolveDuration(String botId, String program) {
        LaundryBotConfig config = botConfigs.get(botId);
        if (config != null && config.getShortCycle() != null && config.getLongCycle() != null) {
            if ("cycle_long".equalsIgnoreCase(program) || "HEAVY".equalsIgnoreCase(program)) {
                return config.getLongCycle().getDuration();
            }
            return config.getShortCycle().getDuration();
        }
        return 30;
    }

    private int resolvePulseCount(String botId, String program) {
        LaundryBotConfig config = botConfigs.get(botId);
        if (config != null && config.getShortCycle() != null && config.getLongCycle() != null) {
            if ("cycle_long".equalsIgnoreCase(program) || "HEAVY".equalsIgnoreCase(program)) {
                return config.getLongCycle().getPulseCount();
            }
            return config.getShortCycle().getPulseCount();
        }
        return 1;
    }
}
