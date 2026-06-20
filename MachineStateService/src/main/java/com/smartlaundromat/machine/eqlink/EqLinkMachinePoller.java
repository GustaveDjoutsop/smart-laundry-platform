package com.smartlaundromat.machine.eqlink;

import com.smartlaundromat.machine.eqlink.dto.EqCheckStatusResponse;
import com.smartlaundromat.machine.eqlink.dto.EqDeviceInfo;
import com.smartlaundromat.machine.eqlink.dto.EqDeviceItem;
import com.smartlaundromat.machine.model.Machine;
import com.smartlaundromat.machine.model.enums.MachineStatus;
import com.smartlaundromat.machine.repository.MachineRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.util.List;

/**
 * Scheduled poller that syncs machine states from the EQLink cloud to the local database.
 *
 * <p>Strategy:
 * <ol>
 *   <li>Call {@code get_device_list} to get all machines and their last known state.</li>
 *   <li>For each machine that maps to an internal ID, call {@code iot_check_dev_status}
 *       to get fresher real-time status.</li>
 *   <li>Update the local {@link Machine} record accordingly.</li>
 * </ol>
 *
 * <p>This component is only instantiated when {@code eqlink.enabled=true} — when EQLink
 * is disabled the bean is not created and no polling occurs.
 *
 * <p>The poller acts as a reconciliation fallback: even if a webhook is missed (EQLink
 * has no webhooks), the state is corrected on the next poll cycle.
 */
@Component
@Slf4j
@RequiredArgsConstructor
@ConditionalOnProperty(name = "eqlink.enabled", havingValue = "true")
public class EqLinkMachinePoller {

    private final EqLinkClient eqLinkClient;
    private final EqLinkProperties props;
    private final MachineRepository machineRepository;

    @Scheduled(fixedDelayString = "${eqlink.poll-interval-ms:30000}")
    public void pollAllMachines() {
        if (!props.isFullyConfigured()) return;

        log.debug("EQLink poll starting...");
        int updated = 0;

        List<EqDeviceItem> devices = eqLinkClient.getDeviceList();
        for (EqDeviceItem device : devices) {
            String internalId = resolveInternalId(device.getDevicename());
            if (internalId == null) continue;

            // For more accurate data call check_dev_status individually
            EqCheckStatusResponse detailed = eqLinkClient.checkDeviceStatus(device.getDevicename());

            machineRepository.findByMachineId(internalId).ifPresent(machine -> {
                if (detailed != null && detailed.isSuccess()) {
                    applyDetailedStatus(machine, detailed);
                } else {
                    applyListStatus(machine, device);
                }
                machineRepository.save(machine);
            });
            updated++;
        }

        log.debug("EQLink poll done — {} machines synced", updated);
    }

    // ── Status mapping ────────────────────────────────────────────────────────

    /**
     * Applies the richer {@code iot_check_dev_status} response to the machine entity.
     *
     * <p>Status mapping from EQLink fields:
     * <ul>
     *   <li>offline (isonline=NO) → {@link MachineStatus#OFFLINE}</li>
     *   <li>online + error (mach_errno≠0) → {@link MachineStatus#ERROR}</li>
     *   <li>online + cycle running (cycle_start=1) → {@link MachineStatus#RUNNING}</li>
     *   <li>online + available=1 → {@link MachineStatus#IDLE}</li>
     *   <li>online + available=0 + no cycle → {@link MachineStatus#MAINTENANCE}</li>
     * </ul>
     */
    private void applyDetailedStatus(Machine machine, EqCheckStatusResponse resp) {
        boolean online = resp.isOnline();
        machine.setIsOnline(online);
        machine.setLastHeartbeat(LocalDateTime.now());

        if (!online) {
            machine.setStatus(MachineStatus.OFFLINE);
            return;
        }

        EqDeviceInfo info = resp.getDeviceStatus();
        if (info == null) {
            machine.setStatus(MachineStatus.IDLE);
            return;
        }

        MachineStatus prev = machine.getStatus();
        MachineStatus next = deriveStatus(info);
        machine.setStatus(next);

        // Update machine error fields
        if (info.getMachErrno() != null && info.getMachErrno() != 0) {
            machine.setErrorCode("EQ-" + info.getMachErrno());
        } else {
            machine.setErrorCode(null);
            machine.setErrorMessage(null);
        }

        if (!prev.equals(next)) {
            log.info("EQLink sync: machine={} {} → {}", machine.getMachineId(), prev, next);
        }
    }

    /** Applies the lighter {@code get_device_list} entry to the machine entity. */
    private void applyListStatus(Machine machine, EqDeviceItem item) {
        boolean online = item.getDeviceStatus() != null && item.getDeviceStatus().isOnline();
        machine.setIsOnline(online);
        machine.setLastHeartbeat(LocalDateTime.now());

        if (!online) {
            machine.setStatus(MachineStatus.OFFLINE);
            return;
        }

        if (item.getDeviceInfo() != null) {
            machine.setStatus(deriveStatus(item.getDeviceInfo()));
        }
    }

    private MachineStatus deriveStatus(EqDeviceInfo info) {
        if (info.hasError())         return MachineStatus.ERROR;
        if (info.isCycleRunning())   return MachineStatus.RUNNING;
        if (info.isAvailable())      return MachineStatus.IDLE;
        return MachineStatus.MAINTENANCE;
    }

    // ── Mapping helpers ───────────────────────────────────────────────────────

    private String resolveInternalId(String devicename) {
        if (devicename == null) return null;
        return props.getDeviceNameMapping().entrySet().stream()
                .filter(e -> devicename.equals(e.getValue()))
                .map(java.util.Map.Entry::getKey)
                .findFirst()
                .orElse(null);
    }
}
