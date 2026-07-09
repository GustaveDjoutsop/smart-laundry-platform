package com.smartlaundromat.machine.integration;

import com.smartlaundromat.machine.model.Reservation;
import com.smartlaundromat.machine.model.enums.ReservationStatus;
import com.smartlaundromat.machine.repository.ReservationRepository;
import com.smartlaundromat.machine.service.ReservationService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.RepeatedTest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.time.LocalDateTime;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Proves the fix for the lost-update race between {@link ReservationService#activateByReference}
 * and the hold-expiry sweep ({@link ReservationService#releaseExpiredHolds}): a payment
 * confirmation racing the sweep's cleanup of the same stale-looking hold must never result
 * in the customer being told "confirmed" while the stored reservation is actually CANCELLED.
 * Before the fix, the sweep read-then-blindly-saved the row, silently clobbering a
 * concurrently-activated reservation back to CANCELLED with no error on either side.
 */
@SpringBootTest
class ReservationActivateVsHoldReleaseConcurrencyIT extends BaseIntegrationTest {

    @Autowired
    private ReservationService reservationService;

    @Autowired
    private ReservationRepository reservationRepository;

    private String currentRef;

    @AfterEach
    void cleanUp() {
        // Each repetition leaves an ACTIVE or CANCELLED row on the shared
        // "test_washer_01" machine — without cleanup these accumulate and can
        // overlap-block slots requested by other IT classes sharing the same
        // Testcontainers Postgres instance (e.g. ReservationServiceConcurrencyIT).
        if (currentRef != null) {
            reservationRepository.findByTransactionReference(currentRef)
                    .ifPresent(reservationRepository::delete);
        }
    }

    @RepeatedTest(10)
    void activationMustNeverSucceedWhileStoredStateEndsUpCancelled() throws InterruptedException {
        String ref = "RACE-REF-" + System.nanoTime();
        currentRef = ref;

        // A hold that looks stale to the sweep (createdAt older than hold-timeout-minutes)
        // but is about to be paid for — exactly the timing this bug depended on.
        Reservation reservation = Reservation.builder()
                .reservationCode("RES-" + System.nanoTime() % 1_000_000)
                .machineId("test_washer_01")
                .customerPhone("+237600000000")
                .status(ReservationStatus.PENDING_PAYMENT)
                .slotStart(LocalDateTime.now().plusHours(1))
                .slotEnd(LocalDateTime.now().plusHours(2))
                .feeAmount(1500)
                .transactionReference(ref)
                .createdAt(LocalDateTime.now().minusMinutes(10))
                .build();
        reservationRepository.save(reservation);

        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        AtomicBoolean activationSucceeded = new AtomicBoolean(false);
        AtomicReference<Throwable> unexpected = new AtomicReference<>();

        ExecutorService pool = Executors.newFixedThreadPool(2);
        pool.submit(() -> {
            ready.countDown();
            try {
                start.await();
                reservationService.activateByReference(ref);
                activationSucceeded.set(true);
            } catch (com.smartlaundromat.machine.exception.ReservationException expected) {
                // Cancel won the race first — activation correctly refused.
            } catch (Throwable t) {
                unexpected.set(t);
            }
        });
        pool.submit(() -> {
            ready.countDown();
            try {
                start.await();
                reservationService.releaseExpiredHolds();
            } catch (Throwable t) {
                unexpected.set(t);
            }
        });

        ready.await(10, TimeUnit.SECONDS);
        start.countDown();
        pool.shutdown();
        assertThat(pool.awaitTermination(30, TimeUnit.SECONDS)).isTrue();

        assertThat(unexpected.get()).as("no unexpected exception").isNull();

        Reservation finalState = reservationRepository.findByTransactionReference(ref).orElseThrow();
        if (activationSucceeded.get()) {
            assertThat(finalState.getStatus())
                    .as("activation reported success — stored state must be ACTIVE, not silently CANCELLED")
                    .isEqualTo(ReservationStatus.ACTIVE);
        } else {
            assertThat(finalState.getStatus())
                    .as("activation was refused — the sweep must have won, stored state CANCELLED")
                    .isEqualTo(ReservationStatus.CANCELLED);
        }
    }

}
