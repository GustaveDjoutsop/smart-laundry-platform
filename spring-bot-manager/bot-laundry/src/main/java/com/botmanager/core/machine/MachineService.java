package com.botmanager.core.machine;

import com.botmanager.bots.laundry.LaundryBotConfig;
import com.botmanager.core.mqtt.MqttManager;
import com.botmanager.core.payment.PaymentEventPublisher;
import com.botmanager.core.payment.PaymentRecord;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

@Slf4j
@Service
@RequiredArgsConstructor
public class MachineService {

    private final MachineStore machineStore;

    private final MqttManager mqttManager;

    private final ObjectMapper objectMapper;

    private final Map<String, LaundryBotConfig> botConfigs = new ConcurrentHashMap<>();

    public void registerBot(LaundryBotConfig botConfig) {
        if (botConfig.getMachines() == null || botConfig.getMachines().isEmpty()) {
            return;
        }

        botConfigs.put(botConfig.getBotId(), botConfig);
        seedMachines(botConfig);
        subscribeToMqtt(botConfig);

        log.info("Registered {} machines for bot {}", botConfig.getMachines().size(), botConfig.getBotId());
    }

    public List<MachineRecord> getMachines(String botId) {
        return machineStore.getMachinesForBot(botId);
    }

    public Optional<MachineRecord> getMachine(String botId, String machineId) {
        return machineStore.getMachine(botId, machineId);
    }

    public List<MachineRecord> getAvailableMachines(String botId) {
        return machineStore.getAvailableMachines(botId);
    }

    public void startMachine(String botId, String machineId, String program, String transactionId) {
        LaundryBotConfig botConfig = botConfigs.get(botId);
        if (botConfig == null || botConfig.getMqtt() == null) {
            log.warn("Cannot start machine, bot {} not configured for MQTT", botId);

            return;
        }

        String topic = botConfig.getMqtt().getTopicPrefix() + "/machine-" + machineId + "/command";

        Map<String, Object> command = new HashMap<>();
        command.put("command", "START");
        command.put("machineId", machineId);
        command.put("program", program);
        command.put("transactionId", transactionId);

        mqttManager.publish(topic, command);

        log.info("Sent START command to machine {} with program {}", machineId, program);
    }

    public void stopMachine(String botId, String machineId, String transactionId) {
        LaundryBotConfig botConfig = botConfigs.get(botId);
        if (botConfig == null || botConfig.getMqtt() == null) {
            return;
        }

        String topic = botConfig.getMqtt().getTopicPrefix() + "/machine-" + machineId + "/command";

        Map<String, Object> command = new HashMap<>();
        command.put("command", "STOP");
        command.put("machineId", machineId);
        command.put("transactionId", transactionId);

        mqttManager.publish(topic, command);

        log.info("Sent STOP command to machine {}", machineId);
    }

    public void requestStatus(String botId, String machineId) {
        LaundryBotConfig botConfig = botConfigs.get(botId);
        if (botConfig == null || botConfig.getMqtt() == null) {
            return;
        }

        String topic = botConfig.getMqtt().getTopicPrefix() + "/machine-" + machineId + "/command";

        Map<String, Object> command = new HashMap<>();
        command.put("command", "STATUS");
        command.put("machineId", machineId);

        mqttManager.publish(topic, command);
    }

    @EventListener
    public void onPaymentCompleted(PaymentEventPublisher.PaymentCompletedEvent event) {
        PaymentRecord record = event.getRecord();

        if (record.getMetadata() == null) {
            return;
        }

        String machineId = (String) record.getMetadata().get("machineId");
        String program = (String) record.getMetadata().get("program");

        if (machineId != null && program != null) {
            startMachine(record.getBotId(), machineId, program, record.getTransactionId());
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

    private void subscribeToMqtt(LaundryBotConfig botConfig) {
        if (botConfig.getMqtt() == null || !mqttManager.isConnected()) {
            return;
        }

        String prefix = botConfig.getMqtt().getTopicPrefix();
        String statusPattern = prefix + "/machine-+/status";
        String heartbeatPattern = prefix + "/machine-+/heartbeat";

        mqttManager.subscribe(statusPattern, (topic, payload) ->
                handleStatusMessage(botConfig.getBotId(), topic, payload));

        mqttManager.subscribe(heartbeatPattern, (topic, payload) ->
                handleHeartbeatMessage(botConfig.getBotId(), topic, payload));
    }

    @SuppressWarnings("unchecked")
    private void handleStatusMessage(String botId, String topic, String payload) {
        try {
            Map<String, Object> data = objectMapper.readValue(payload, Map.class);
            String machineId = extractMachineIdFromTopic(topic);

            machineStore.getMachine(botId, machineId).ifPresent(machine -> {
                String status = (String) data.get("status");
                String program = (String) data.get("program");
                Integer remainingSeconds = (Integer) data.get("remainingSeconds");
                String currentUser = (String) data.get("currentUser");

                if (status != null) {
                    machine.setStatus(MachineStatus.fromValue(status));
                }

                if (program != null) {
                    machine.setProgram(program);
                }

                if (remainingSeconds != null) {
                    machine.setRemainingSeconds(remainingSeconds);
                }

                if (currentUser != null) {
                    machine.setCurrentUser(currentUser);
                }

                machineStore.upsertMachine(machine);

                log.debug("Updated machine {} status: {}", machineId, status);
            });
        } catch (Exception exception) {
            log.error("Failed to handle status message: {}", exception.getMessage());
        }
    }

    private void handleHeartbeatMessage(String botId, String topic, String payload) {
        String machineId = extractMachineIdFromTopic(topic);

        machineStore.getMachine(botId, machineId).ifPresent(machine -> {
            machine.setLastHeartbeatAt(Instant.now());
            machineStore.upsertMachine(machine);
        });
    }

    private String extractMachineIdFromTopic(String topic) {
        String[] parts = topic.split("/");

        for (String part : parts) {
            if (part.startsWith("machine-")) {
                return part.substring("machine-".length());
            }
        }

        return null;
    }

}
