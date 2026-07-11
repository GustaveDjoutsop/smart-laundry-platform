package com.smartlaundromat.payment.integration;

import com.smartlaundromat.payment.dto.PaymentInitiationRequest;
import com.smartlaundromat.payment.dto.PaymentResponse;
import com.smartlaundromat.payment.exception.PaymentException;
import com.smartlaundromat.payment.model.enums.PaymentProvider;
import com.smartlaundromat.payment.model.enums.PaymentStatus;
import com.smartlaundromat.payment.repository.TransactionRepository;
import com.smartlaundromat.payment.service.PaymentService;
import com.smartlaundromat.payment.service.machine.MachineAvailabilityClient;
import com.smartlaundromat.payment.service.machine.ReservationClient;
import com.smartlaundromat.payment.service.provider.CampayService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/**
 * Proves the fix for the check-then-act race in {@link PaymentService#initiatePayment}
 * (Bug 2/3 root cause): two concurrent requests for the same machine must not both
 * succeed. Requires a real Postgres (the partial unique index added in
 * V11__transactions_pending_machine_unique.sql is what actually enforces this —
 * mocked-repository unit tests can't exercise it).
 */
@SpringBootTest
class PaymentServiceConcurrencyIT extends BaseIntegrationTest {

    @Autowired
    private PaymentService paymentService;

    @Autowired
    private TransactionRepository transactionRepository;

    @MockBean
    private MachineAvailabilityClient machineAvailabilityClient;

    @MockBean
    private ReservationClient reservationClient;

    @MockBean
    private CampayService campayService;

    @Test
    void onlyOneOfTwoConcurrentPaymentsForTheSameMachineShouldSucceed() throws InterruptedException {
        // machine_id column is VARCHAR(30) — keep this short, unique per run.
        String machineId = "conc_" + (System.nanoTime() % 1_000_000_000L);
        when(machineAvailabilityClient.isAvailable(machineId)).thenReturn(true);
        when(reservationClient.checkConflict(anyString(), anyInt(), any())).thenReturn(Optional.empty());
        when(campayService.requestPayment(anyString(), org.mockito.ArgumentMatchers.any(BigDecimal.class), anyString(), anyString()))
                .thenReturn(PaymentResponse.builder().success(true).providerReference("CAMP-CONCURRENCY").build());

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
                    PaymentInitiationRequest request = new PaymentInitiationRequest();
                    request.setPhoneNumber("237612345678");
                    request.setAmount(new BigDecimal("1000"));
                    request.setMachineId(machineId);
                    request.setPulseCount(1);
                    request.setCycleDuration(30);
                    request.setProvider(PaymentProvider.CAMPAY);
                    request.setDescription("Concurrency test");
                    paymentService.initiatePayment(request);
                    succeeded.incrementAndGet();
                } catch (PaymentException e) {
                    rejected.incrementAndGet();
                } catch (Throwable t) {
                    unexpected.set(t);
                } finally {
                    // no-op
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

        List<com.smartlaundromat.payment.model.Transaction> pending =
                transactionRepository.findByMachineIdAndStatus(machineId, PaymentStatus.PENDING);
        assertThat(pending).hasSize(1);
    }

}
