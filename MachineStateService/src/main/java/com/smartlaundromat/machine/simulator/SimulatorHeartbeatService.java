package com.smartlaundromat.machine.simulator;

import com.smartlaundromat.machine.config.MachineConfig;
import com.smartlaundromat.machine.dto.TelemetryPayload;
import com.smartlaundromat.machine.model.Machine;
import com.smartlaundromat.machine.model.enums.MachineStatus;
import com.smartlaundromat.machine.model.enums.MachineType;
import com.smartlaundromat.machine.repository.MachineRepository;
import com.smartlaundromat.machine.service.MachineService;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.Collection;
import java.util.List;
import java.util.Locale;

/**
 * Drives simulated machine state in dev when {@code simulator.enabled=true}.
 * <p>
 * Two scheduled tasks:
 * <ol>
 *   <li><b>Heartbeat</b> (every {@code heartbeatIntervalMs}) — marks every non-RUNNING machine
 *       ONLINE with two set-based UPDATEs. This makes all machines show as AVAILABLE to the bot
 *       and dashboard within seconds of startup. It deliberately does <em>not</em> go through
 *       {@code processTelemetry()} per machine: that read-then-write loop cost a full 30-column
 *       SELECT plus a whole-entity save per machine per tick, which on 16 machines at a 30s
 *       interval was ~92k reads and ~92k writes a day against the managed database — the bulk of
 *       its egress — purely to restate values that had not changed. The idle payload's simulated
 *       temperature, humidity and power-consumption jitter is no longer persisted; idle machines
 *       keep whatever those columns last held. Status, door lock, spin speed, online flag and
 *       heartbeat — everything the bot and dashboard actually read — are still maintained.</li>
 *   <li><b>Progress update</b> (every {@code telemetryUpdateIntervalMs}) — for each RUNNING
 *       machine, computes the elapsed-time-based progress and sends a realistic telemetry
 *       payload (temperature, spin speed, door locked). The actual RUNNING → FINISHED
 *       transition is handled by the existing {@link com.smartlaundromat.machine.service.CycleMonitorService}.</li>
 * </ol>
 */
@Service
@Slf4j
@RequiredArgsConstructor
@ConditionalOnProperty(name = "simulator.enabled", havingValue = "true")
public class SimulatorHeartbeatService {

    /**
     * Statuses the heartbeat must not overwrite: RUNNING belongs to a live cycle, FINISHED is
     * cleared by {@code CycleMonitorService} once its grace period elapses, and ERROR and
     * MAINTENANCE mean something real is wrong with the machine. Everything else — IDLE, OFFLINE,
     * PAUSED — is reset to IDLE, which is what brings machines online at startup.
     */
    private static final Collection<MachineStatus> PRESERVED_STATUSES = List.of(
            MachineStatus.RUNNING, MachineStatus.FINISHED,
            MachineStatus.ERROR, MachineStatus.MAINTENANCE);

    /** Statuses kept as-is while still taking the heartbeat: {@link #PRESERVED_STATUSES} minus RUNNING. */
    private static final Collection<MachineStatus> HEARTBEAT_ONLY_STATUSES = List.of(
            MachineStatus.FINISHED, MachineStatus.ERROR, MachineStatus.MAINTENANCE);

    private static final Collection<String> LOCAL_DATABASE_HOSTS =
            List.of("localhost", "127.0.0.1", "0.0.0.0", "::1", "0:0:0:0:0:0:0:1", "host.docker.internal");

    private static final String JDBC_AUTHORITY_SEPARATOR = "//";
    private static final String CREDENTIALS_SEPARATOR = "@";

    private final MachineService machineService;
    private final MachineRepository machineRepository;
    private final MachineConfig machineConfig;

    @Value("${spring.datasource.url:}")
    private String datasourceUrl;

    @Value("${simulator.allow-non-local-database:false}")
    private boolean allowNonLocalDatabase;

    /** Set once at startup by {@link #suspendAgainstNonLocalDatabase()}; stops both ticks dead. */
    private boolean simulatorSuspended;

    /**
     * Suspends the simulator when it is pointed at anything but a local database. The simulator
     * writes to every configured machine every 30 seconds forever; against a shared or managed
     * project that is production-shaped write load nobody is watching, and it was the bulk of this
     * project's Supabase egress. Set {@code simulator.allow-non-local-database=true} to override
     * deliberately.
     * <p>
     * Suspending rather than throwing is deliberate. Railway builds a preview environment per pull
     * request from a template that has {@code SIMULATOR_ENABLED=true}, and no per-PR step sets it
     * otherwise, so failing the context would brick every preview deploy of this service rather
     * than fix anything. The egress outcome is identical — the ticks below do not run — and the
     * misconfiguration is logged at ERROR on every startup instead of being silently expensive.
     * <p>
     * This inspects the configured URL only, so it cannot see through a local port-forward or an
     * SSH/Supavisor tunnel: {@code jdbc:postgresql://127.0.0.1:6543/postgres} pointed at a managed
     * project reads as local and keeps ticking. The guard raises the floor; it is not airtight.
     */
    @PostConstruct
    public void suspendAgainstNonLocalDatabase() {
        simulatorSuspended = !allowNonLocalDatabase && !isLocalDatabase(datasourceUrl);

        if (simulatorSuspended) {
            log.error("[SIMULATOR] Suspended: simulator.enabled=true but spring.datasource.url is not "
                    + "a local database. The simulator writes to every machine on every tick and must "
                    + "never run against a shared or managed project, so no simulated telemetry will be "
                    + "produced. Set SIMULATOR_ENABLED=false for this environment, or "
                    + "simulator.allow-non-local-database=true if this is intentional.");
        }
    }

    @Scheduled(fixedDelayString = "${simulator.heartbeat-interval-ms:30000}")
    @Transactional
    public void sendHeartbeats() {
        if (simulatorSuspended) {
            return;
        }

        LocalDateTime heartbeatAt = LocalDateTime.now();
        List<String> machineIds = machineConfig.getAvailableIds();

        int idled = machineRepository.markSimulatedMachinesIdle(
                machineIds, MachineStatus.IDLE, PRESERVED_STATUSES, heartbeatAt);
        int preserved = machineRepository.markHeartbeatOnly(
                machineIds, HEARTBEAT_ONLY_STATUSES, heartbeatAt);

        log.debug("[SIMULATOR] Heartbeat applied to {} idle and {} status-preserved machines",
                idled, preserved);
    }

    @Scheduled(fixedDelayString = "${simulator.telemetry-update-interval-ms:30000}")
    public void updateRunningMachines() {
        if (simulatorSuspended) {
            return;
        }

        List<Machine> running = machineRepository.findByMachineIdInAndStatus(
                machineConfig.getAvailableIds(), MachineStatus.RUNNING);
        for (Machine machine : running) {
            machineService.processTelemetry(buildRunningTelemetry(machine));
        }
        if (!running.isEmpty()) {
            log.debug("[SIMULATOR] Progress update sent to {} running machines", running.size());
        }
    }

    TelemetryPayload buildRunningTelemetry(Machine machine) {
        int progress = computeProgress(machine);
        TelemetryPayload t = new TelemetryPayload();
        t.setMachineId(machine.getMachineId());
        t.setStatus("RUNNING");
        t.setCycleProgress(progress);
        t.setDoorLocked(true);
        t.setTemperature(runningTemperature(machine, progress));
        t.setHumidity(60.0 + progress * 0.2);
        t.setSpinSpeed(runningSpinSpeed(machine, progress));
        t.setPowerConsumption(machine.getType() == MachineType.DRYER ? 2000.0 : 800.0 + progress * 5);
        t.setVibration(machine.getType() == MachineType.WASHER && progress > 80 ? 2.5 + Math.random() : 0.5);
        return t;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    int computeProgress(Machine machine) {
        if (machine.getCycleStartedAt() == null || machine.getCycleEndsAt() == null) {
            return 0;
        }
        long totalSeconds = ChronoUnit.SECONDS.between(machine.getCycleStartedAt(), machine.getCycleEndsAt());
        if (totalSeconds <= 0) return 100;
        long elapsedSeconds = ChronoUnit.SECONDS.between(machine.getCycleStartedAt(), LocalDateTime.now());
        return (int) Math.min(99, Math.max(0, (elapsedSeconds * 100) / totalSeconds));
    }

    /**
     * Whether the JDBC URL names a loopback host. Matches the extracted host exactly rather than
     * searching the whole URL, so neither a database name nor a hostname such as
     * {@code localhost.example.com} can masquerade as local.
     */
    static boolean isLocalDatabase(String url) {
        String host = extractHost(url);

        return host != null && LOCAL_DATABASE_HOSTS.contains(host);
    }

    private static String extractHost(String url) {
        if (!StringUtils.hasText(url)) {
            return null;
        }

        int authorityStart = url.indexOf(JDBC_AUTHORITY_SEPARATOR);
        if (authorityStart < 0) {
            return null;
        }

        String authority = url.substring(authorityStart + JDBC_AUTHORITY_SEPARATOR.length());
        int pathStart = indexOfFirst(authority, '/', '?');
        if (pathStart >= 0) {
            authority = authority.substring(0, pathStart);
        }

        int credentialsEnd = authority.lastIndexOf(CREDENTIALS_SEPARATOR);
        if (credentialsEnd >= 0) {
            authority = authority.substring(credentialsEnd + CREDENTIALS_SEPARATOR.length());
        }

        return stripPort(authority).toLowerCase(Locale.ROOT);
    }

    /**
     * Drops the {@code :port} suffix, leaving bracketed IPv6 literals intact before unwrapping
     * them — {@code [::1]:5432} must not be split on its first colon.
     */
    private static String stripPort(String authority) {
        if (authority.startsWith("[")) {
            int bracketEnd = authority.indexOf(']');

            return bracketEnd > 0 ? authority.substring(1, bracketEnd) : authority;
        }

        int portStart = authority.indexOf(':');

        return portStart >= 0 ? authority.substring(0, portStart) : authority;
    }

    private static int indexOfFirst(String value, char first, char second) {
        int firstIndex = value.indexOf(first);
        int secondIndex = value.indexOf(second);

        if (firstIndex < 0) {
            return secondIndex;
        }
        if (secondIndex < 0) {
            return firstIndex;
        }

        return Math.min(firstIndex, secondIndex);
    }

    private double runningTemperature(Machine machine, int progress) {
        return machine.getType() == MachineType.WASHER
                ? 22.0 + progress * 0.6     // washer heats from 22° to ~82°
                : 25.0 + progress * 0.9;     // dryer heats from 25° to ~115°
    }

    private int runningSpinSpeed(Machine machine, int progress) {
        if (machine.getType() == MachineType.DRYER) return 0;
        // Washer: slow at start/fill, fast in the middle, slow at rinse end
        if (progress < 20) return 50;
        if (progress < 70) return 800;
        if (progress > 85) return 1200;
        return 500;
    }
}
