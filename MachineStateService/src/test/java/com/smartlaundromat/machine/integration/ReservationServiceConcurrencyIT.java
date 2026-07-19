package com.smartlaundromat.machine.integration;

import com.smartlaundromat.machine.dto.CreateReservationRequest;
import com.smartlaundromat.machine.exception.ReservationException;
import com.smartlaundromat.machine.model.Reservation;
import com.smartlaundromat.machine.repository.ReservationRepository;
import com.smartlaundromat.machine.service.ReservationService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.time.LocalDateTime;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Proves the fix for the check-then-act race in {@link ReservationService#createReservation}
 * (Bug 1/2 root cause): two concurrent reservation requests for the same machine and
 * overlapping slot must not both succeed. Requires a real Postgres — the pessimistic
 * lock on the machine row is what actually enforces this; mocked-repository unit
 * tests can't exercise it.
 */
@SpringBootTest
class ReservationServiceConcurrencyIT extends BaseIntegrationTest {

    @Autowired
    private ReservationService reservationService;

    @Autowired
    private ReservationRepository reservationRepository;

    @Test
    void onlyOneOfTwoConcurrentReservationsForTheSameMachineAndSlotShouldSucceed() throws InterruptedException {
        // Seeded by MachineService.initializeMachines() at startup.
        String machineId = "test_washer_01";
        LocalDateTime slotStart = LocalDateTime.now().plusHours(2).withNano(0);

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
                    CreateReservationRequest request = new CreateReservationRequest();
                    request.setMachineId(machineId);
                    request.setCustomerPhone("+237600000000");
                    request.setSlotStart(slotStart);
                    reservationService.createReservation(request);
                    succeeded.incrementAndGet();
                } catch (ReservationException e) {
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

        List<Reservation> forMachine = reservationRepository.findByMachineIdOrderBySlotStartDesc(machineId);
        assertThat(forMachine).hasSize(1);
    }

}
