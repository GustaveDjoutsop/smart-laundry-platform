package com.smartlaundromat.machine.integration;

import com.smartlaundromat.contracts.machine.MachineStartRequest;
import com.smartlaundromat.machine.exception.MachineNotAvailableException;
import com.smartlaundromat.machine.model.enums.CycleStatus;
import com.smartlaundromat.machine.repository.MachineCycleRepository;
import com.smartlaundromat.machine.service.MachineService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Proves the fix for the check-then-act race in {@link MachineService#startCycle}
 * (Bug 2 root cause): two concurrent start requests for the same machine must not
 * both succeed. Requires a real Postgres (the pessimistic lock + the partial unique
 * index added in V3__machine_cycles_in_progress_unique.sql are what actually enforce
 * this — mocked-repository unit tests can't exercise it).
 */
@SpringBootTest
class MachineServiceConcurrencyIT extends BaseIntegrationTest {

    @Autowired
    private MachineService machineService;

    @Autowired
    private MachineCycleRepository machineCycleRepository;

    @Test
    void onlyOneOfTwoConcurrentStartCyclesForTheSameMachineShouldSucceed() throws InterruptedException {
        // Seeded by MachineService.initializeMachines() at startup, from the
        // "machine.available-ids" test property.
        String machineId = "test_washer_01";

        int attempts = 8;
        ExecutorService pool = Executors.newFixedThreadPool(attempts);
        CountDownLatch ready = new CountDownLatch(attempts);
        CountDownLatch start = new CountDownLatch(1);
        AtomicInteger succeeded = new AtomicInteger();
        AtomicInteger rejected = new AtomicInteger();
        AtomicReference<Throwable> unexpected = new AtomicReference<>();

        for (int i = 0; i < attempts; i++) {
            pool.submit(() -> {
                ready.countDown();
                try {
                    start.await();
                    MachineStartRequest request = new MachineStartRequest(
                            machineId, "NORMAL", 30, 1, null, null, null);
                    machineService.startCycle(request);
                    succeeded.incrementAndGet();
                } catch (MachineNotAvailableException e) {
                    rejected.incrementAndGet();
                } catch (Throwable t) {
                    unexpected.set(t);
                }
            });
        }

        ready.await(10, TimeUnit.SECONDS);
        start.countDown();
        pool.shutdown();
        assertThat(pool.awaitTermination(30, TimeUnit.SECONDS)).isTrue();

        assertThat(unexpected.get()).as("no unexpected exception").isNull();
        assertThat(succeeded.get()).as("exactly one request should win the race").isEqualTo(1);
        assertThat(rejected.get()).isEqualTo(attempts - 1);

        List<com.smartlaundromat.machine.model.MachineCycle> inProgress =
                machineCycleRepository.findByMachineIdAndStatus(machineId, CycleStatus.IN_PROGRESS)
                        .map(List::of)
                        .orElse(List.of());
        assertThat(inProgress).hasSize(1);
    }

}
