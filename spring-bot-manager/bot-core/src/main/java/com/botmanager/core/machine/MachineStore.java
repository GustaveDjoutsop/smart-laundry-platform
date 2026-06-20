package com.botmanager.core.machine;

import com.botmanager.core.redis.RedisManager;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

@Slf4j
@Component
@RequiredArgsConstructor
public class MachineStore {

    private static final String MACHINE_KEY_PREFIX = "machine:";

    private static final String MACHINE_LIST_KEY_PREFIX = "machines:";

    private static final long DEFAULT_TTL_SECONDS = 86400;

    private final RedisManager redisManager;

    private final ObjectMapper objectMapper;

    public void upsertMachine(MachineRecord record) {
        String key = MACHINE_KEY_PREFIX + record.getBotId() + ":" + record.getMachineId();
        record.setUpdatedAt(Instant.now());

        redisManager.setWithExpiry(key, record, DEFAULT_TTL_SECONDS);

        addToMachineList(record.getBotId(), record.getMachineId());

        log.debug("Upserted machine {} for bot {}", record.getMachineId(), record.getBotId());
    }

    public Optional<MachineRecord> getMachine(String botId, String machineId) {
        String key = MACHINE_KEY_PREFIX + botId + ":" + machineId;

        return redisManager.get(key, MachineRecord.class);
    }

    public List<MachineRecord> getMachinesForBot(String botId) {
        List<MachineRecord> machines = new ArrayList<>();
        String listKey = MACHINE_LIST_KEY_PREFIX + botId;

        redisManager.get(listKey).ifPresent(json -> {
            try {
                List<String> machineIds = objectMapper.readValue(json, new TypeReference<List<String>>() {});

                for (String machineId : machineIds) {
                    getMachine(botId, machineId).ifPresent(machines::add);
                }
            } catch (Exception exception) {
                log.warn("Failed to parse machine list: {}", exception.getMessage());
            }
        });

        return machines;
    }

    public List<MachineRecord> getAvailableMachines(String botId) {
        return getMachinesForBot(botId).stream()
                .filter(machine -> machine.getStatus() == MachineStatus.AVAILABLE)
                .toList();
    }

    private void addToMachineList(String botId, String machineId) {
        String listKey = MACHINE_LIST_KEY_PREFIX + botId;
        List<String> machineIds = new ArrayList<>();

        redisManager.get(listKey).ifPresent(json -> {
            try {
                machineIds.addAll(objectMapper.readValue(json, new TypeReference<List<String>>() {}));
            } catch (Exception exception) {
                log.warn("Failed to parse existing machine list: {}", exception.getMessage());
            }
        });

        if (!machineIds.contains(machineId)) {
            machineIds.add(machineId);

            try {
                String json = objectMapper.writeValueAsString(machineIds);
                redisManager.setWithExpiry(listKey, json, DEFAULT_TTL_SECONDS);
            } catch (Exception exception) {
                log.error("Failed to update machine list: {}", exception.getMessage());
            }
        }
    }

}
