package com.smartlaundromat.machine.service;

import com.smartlaundromat.contracts.reservation.ReservationRequest;
import com.smartlaundromat.contracts.reservation.ReservationResponse;
import com.smartlaundromat.machine.client.PricingClient;
import com.smartlaundromat.machine.config.FeatureProperties;
import com.smartlaundromat.machine.config.ReservationProperties;
import com.smartlaundromat.machine.dto.*;
import com.smartlaundromat.machine.exception.MachineNotFoundException;
import com.smartlaundromat.machine.exception.ReservationException;
import com.smartlaundromat.machine.model.Machine;
import com.smartlaundromat.machine.model.Reservation;
import com.smartlaundromat.machine.model.enums.CycleStatus;
import com.smartlaundromat.machine.model.enums.ReservationStatus;
import com.smartlaundromat.machine.repository.MachineCycleRepository;
import com.smartlaundromat.machine.repository.MachineRepository;
import com.smartlaundromat.machine.repository.ReservationRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;

/**
 * Reservation mechanism (feature-flagged via {@code features.reservation-enabled}).
 *
 * <h2>Lifecycle</h2>
 * <ol>
 *   <li>{@link #createReservation} — generates a unique code for a 1-hour slot, fee = highest
 *       wash cycle price, status {@code PENDING_PAYMENT}. The code is delivered to WhatsApp by
 *       the bot. The reservation is <em>not</em> a wash cycle — the normal wash price is paid
 *       separately.</li>
 *   <li>{@link #activateByReference} — called once the reservation-fee payment is confirmed;
 *       the reservation becomes {@code ACTIVE} and the machine is held for its slot.</li>
 *   <li>{@link #validateAndConsume} — when the customer sends the code back to run the machine,
 *       the code is cross-checked against <strong>code + machine</strong> (never the user) and,
 *       if valid and within the slot, marked {@code USED}.</li>
 * </ol>
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class ReservationService {

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final char[] CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".toCharArray();

    private final ReservationRepository reservationRepository;
    private final MachineRepository machineRepository;
    private final MachineCycleRepository machineCycleRepository;
    private final FeatureProperties featureProperties;
    private final ReservationProperties reservationProperties;
    private final PricingClient pricingClient;

    public boolean isEnabled() {
        return featureProperties.isReservationEnabled();
    }

    private void requireEnabled() {
        if (!isEnabled()) {
            throw new ReservationException("Reservation feature is disabled");
        }
    }

    // ── Create ────────────────────────────────────────────────────────────────

    /**
     * Creates a PENDING_PAYMENT reservation for a fixed 1-hour slot.
     * Rejects overlapping reservations on the same machine.
     */
    @Transactional
    public ReservationResponse createReservation(ReservationRequest request) {
        requireEnabled();

        // Locked fetch: holds the machine row for the rest of this transaction so
        // the overlap check below and the reservation save are atomic against a
        // second concurrent createReservation call for the same machine/slot.
        Machine machine = machineRepository.findByMachineIdForUpdate(request.machineId())
                .orElseThrow(() -> new MachineNotFoundException(
                        "Machine not found: " + request.machineId()));

        LocalDateTime start = request.slotStart();
        if (start == null) {
            throw new ReservationException("Slot start is required");
        }
        if (start.isBefore(LocalDateTime.now().minusMinutes(1))) {
            throw new ReservationException("Slot start must not be in the past");
        }
        // Slot is ALWAYS exactly one hour — not less, not more.
        LocalDateTime end = start.plusMinutes(ReservationProperties.SLOT_MINUTES);

        List<Reservation> overlapping = reservationRepository.findOverlapping(
                request.machineId(), start, end);
        if (!overlapping.isEmpty()) {
            throw new ReservationException(
                    "Machine " + request.machineId() + " is already reserved for that time slot");
        }

        // Mirror image of the overlap check above: a machine currently mid-cycle (started by a
        // walk-in) must not be reservable for a slot it will still be physically running in.
        // A running cycle's startedAt is always <= now <= start (slotStart can't be in the past,
        // checked above), so full interval overlap reduces to this one condition: endsAt > start.
        machineCycleRepository.findByMachineIdAndStatus(request.machineId(), CycleStatus.IN_PROGRESS)
                .filter(cycle -> cycle.getEndsAt() != null && cycle.getEndsAt().isAfter(start))
                .ifPresent(cycle -> {
                    throw new ReservationException(
                            "Machine " + request.machineId() + " is currently running a cycle until "
                                    + cycle.getEndsAt() + " — choose a later slot");
                });

        String code = generateUniqueCode();
        String reference = "RESV-" + request.machineId() + "-" + System.currentTimeMillis();

        Reservation reservation = Reservation.builder()
                .reservationCode(code)
                .machineId(request.machineId())
                .customerPhone(request.customerPhone())
                .slotStart(start)
                .slotEnd(end)
                .status(ReservationStatus.PENDING_PAYMENT)
                .feeAmount(pricingClient.getReservationFee())
                .currency(reservationProperties.getCurrency())
                .transactionReference(reference)
                .build();
        reservationRepository.save(reservation);

        log.info("Reservation created: code={} machine={} slot={}..{} fee={} {} ref={}",
                code, request.machineId(), start, end,
                reservation.getFeeAmount(), reservation.getCurrency(), reference);

        return buildResponse(reservation, machine.getDisplayName(),
                "Reservation created. Pay the reservation fee to activate it, then send the code to run the machine.");
    }

    // ── Activate (on payment confirmation) ──────────────────────────────────────

    @Transactional
    public ReservationResponse activateByReference(String transactionReference) {
        requireEnabled();
        // Locked fetch: prevents this read-then-write from racing a concurrent
        // cancel/activate call or the hold-expiry sweep on the same reservation.
        Reservation reservation = reservationRepository.findByTransactionReferenceForUpdate(transactionReference)
                .orElseThrow(() -> new ReservationException(
                        "No reservation for transaction reference: " + transactionReference));

        if (reservation.getStatus() == ReservationStatus.ACTIVE) {
            return toResponse(reservation, "Reservation already active");
        }
        if (reservation.getStatus() != ReservationStatus.PENDING_PAYMENT) {
            throw new ReservationException(
                    "Reservation cannot be activated from status " + reservation.getStatus());
        }
        if (!reservation.getSlotEnd().isAfter(LocalDateTime.now())) {
            reservation.setStatus(ReservationStatus.EXPIRED);
            reservationRepository.save(reservation);
            throw new ReservationException("Reservation slot has already ended");
        }

        reservation.setStatus(ReservationStatus.ACTIVE);
        reservation.setActivatedAt(LocalDateTime.now());
        reservationRepository.save(reservation);

        log.info("Reservation ACTIVATED: code={} machine={} ref={}",
                reservation.getReservationCode(), reservation.getMachineId(), transactionReference);
        return toResponse(reservation, "Reservation is now active for its 1-hour slot");
    }

    // ── Cancel (payment failed, or never initiated) ──────────────────────────────

    /**
     * Releases a not-yet-activated hold, e.g. when the reservation-fee payment fails
     * or the caller never proceeds to pay. Only {@code PENDING_PAYMENT} reservations
     * can be cancelled — an already-{@code ACTIVE} one has been paid for and must go
     * through support, not a silent cancel.
     */
    @Transactional
    public ReservationResponse cancel(String transactionReference) {
        requireEnabled();
        // Locked fetch: same reasoning as activateByReference above.
        Reservation reservation = reservationRepository.findByTransactionReferenceForUpdate(transactionReference)
                .orElseThrow(() -> new ReservationException(
                        "No reservation for transaction reference: " + transactionReference));

        if (reservation.getStatus() == ReservationStatus.CANCELLED) {
            return toResponse(reservation, "Reservation already cancelled");
        }
        if (reservation.getStatus() != ReservationStatus.PENDING_PAYMENT) {
            throw new ReservationException(
                    "Reservation cannot be cancelled from status " + reservation.getStatus());
        }

        reservation.setStatus(ReservationStatus.CANCELLED);
        reservationRepository.save(reservation);

        log.info("Reservation CANCELLED: code={} machine={} ref={}",
                reservation.getReservationCode(), reservation.getMachineId(), transactionReference);
        return toResponse(reservation, "Reservation hold released");
    }

    // ── Validate / consume (code + machine) ─────────────────────────────────────

    /**
     * Read-only check of a code against a machine. Does not change state.
     */
    @Transactional(readOnly = true)
    public ValidateReservationResponse validate(String reservationCode, String machineId) {
        requireEnabled();
        return reservationRepository.findByReservationCodeAndMachineId(reservationCode, machineId)
                .map(r -> evaluate(r))
                .orElse(invalid(reservationCode, machineId, "NOT_FOUND", null));
    }

    /**
     * Validates a code against a machine and, if valid and within the slot, marks it USED.
     * This is the gate used before a reserved machine is started.
     *
     * @throws ReservationException when the code is invalid for that machine
     */
    @Transactional
    public Reservation validateAndConsume(String reservationCode, String machineId) {
        requireEnabled();
        Reservation reservation = reservationRepository
                .findByReservationCodeAndMachineId(reservationCode, machineId)
                .orElseThrow(() -> new ReservationException(
                        "No reservation with that code for machine " + machineId));

        ValidateReservationResponse check = evaluate(reservation);
        if (!check.isValid()) {
            throw new ReservationException("Reservation not usable: " + check.getReason());
        }

        reservation.setStatus(ReservationStatus.USED);
        reservation.setUsedAt(LocalDateTime.now());
        reservationRepository.save(reservation);
        log.info("Reservation REDEEMED: code={} machine={}", reservationCode, machineId);
        return reservation;
    }

    private ValidateReservationResponse evaluate(Reservation r) {
        if (r.getStatus() == ReservationStatus.USED) {
            return invalid(r.getReservationCode(), r.getMachineId(), "USED", r.getStatus());
        }
        if (r.getStatus() == ReservationStatus.CANCELLED) {
            return invalid(r.getReservationCode(), r.getMachineId(), "CANCELLED", r.getStatus());
        }
        if (r.getStatus() == ReservationStatus.PENDING_PAYMENT) {
            return invalid(r.getReservationCode(), r.getMachineId(), "NOT_ACTIVE", r.getStatus());
        }
        if (r.getStatus() == ReservationStatus.EXPIRED || !r.coversNow()) {
            return invalid(r.getReservationCode(), r.getMachineId(), "OUT_OF_SLOT", r.getStatus());
        }
        return ValidateReservationResponse.builder()
                .valid(true)
                .reservationCode(r.getReservationCode())
                .machineId(r.getMachineId())
                .status(r.getStatus())
                .build();
    }

    private ValidateReservationResponse invalid(String code, String machineId,
                                                String reason, ReservationStatus status) {
        return ValidateReservationResponse.builder()
                .valid(false).reason(reason)
                .reservationCode(code).machineId(machineId).status(status)
                .build();
    }

    // ── Gating helpers used by MachineService.startCycle ────────────────────────

    /**
     * Returns the active reservation currently holding this machine (if any),
     * or empty when the machine is free to use without a code.
     */
    @Transactional(readOnly = true)
    public Optional<Reservation> activeReservationCovering(String machineId) {
        if (!isEnabled()) return Optional.empty();
        return reservationRepository.findActiveCovering(machineId, LocalDateTime.now());
    }

    /**
     * Earliest reservation (PENDING_PAYMENT or ACTIVE) overlapping {@code [windowStart, windowEnd)}
     * on this machine, other than {@code excludeReservationCode} — used both to block a walk-in
     * whose chosen cycle duration would run into an upcoming reservation, and as the final
     * defense-in-depth check in {@code MachineService.startCycle}.
     */
    @Transactional(readOnly = true)
    public Optional<Reservation> findConflicting(String machineId, LocalDateTime windowStart,
                                                  LocalDateTime windowEnd, String excludeReservationCode) {
        if (!isEnabled()) return Optional.empty();
        return reservationRepository.findOverlapping(machineId, windowStart, windowEnd).stream()
                .filter(r -> excludeReservationCode == null
                        || !r.getReservationCode().equalsIgnoreCase(excludeReservationCode.trim()))
                .min(Comparator.comparing(Reservation::getSlotStart));
    }

    // ── Queries ─────────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public ReservationResponse getByCode(String code) {
        requireEnabled();
        Reservation r = reservationRepository.findByReservationCode(code)
                .orElseThrow(() -> new ReservationException("Reservation not found: " + code));
        return toResponse(r, null);
    }

    @Transactional(readOnly = true)
    public List<Reservation> listForMachine(String machineId) {
        return reservationRepository.findByMachineIdOrderBySlotStartDesc(machineId);
    }

    /**
     * A customer's currently-held reservations (PENDING_PAYMENT or ACTIVE), soonest
     * first — feature-flagged like everything else here, so a disabled feature
     * reports no held reservations rather than stale ones.
     *
     * <p>Returns the shared {@code ReservationResponse} contract type, not the raw entity
     * (R8) — the untyped-Map-based bot-laundry client this feeds was, until R8, forced to
     * parse whatever shape this returned; that only worked by coincidence because the two
     * happened to share several field names.
     *
     * <p>{@code toResponse} does one {@code machineRepository} lookup per reservation
     * (N+1) rather than batching — acceptable here because "currently held" is bounded to
     * a handful of rows per customer, and every other caller of {@code toResponse}
     * (activate/cancel/getByCode) already has this same one-lookup shape.
     */
    @Transactional(readOnly = true)
    public List<ReservationResponse> listHeldForCustomer(String customerPhone) {
        if (!isEnabled()) return List.of();
        return reservationRepository.findHeldByCustomerPhone(customerPhone).stream()
                .map(r -> toResponse(r, null))
                .toList();
    }

    // ── Scheduled expiry ──────────────────────────────────────────────────────────

    /** Expires reservations whose 1-hour slot has elapsed without redemption. */
    @Scheduled(fixedDelayString = "${reservation.expiry-check-ms:60000}")
    @Transactional
    public void expireOverdue() {
        if (!isEnabled()) return;
        List<Reservation> expirable = reservationRepository.findExpirable(LocalDateTime.now());
        for (Reservation r : expirable) {
            r.setStatus(ReservationStatus.EXPIRED);
        }
        if (!expirable.isEmpty()) {
            reservationRepository.saveAll(expirable);
            log.info("Expired {} overdue reservation(s)", expirable.size());
        }
    }

    /**
     * Releases holds that were created but never paid for within
     * {@code reservation.hold-timeout-minutes}. Distinct from {@link #expireOverdue()}
     * (which handles slots that elapsed with a valid, possibly-active reservation) —
     * this handles the abandoned-checkout case, so the slot doesn't stay blocked until
     * {@code slotEnd} just because a customer never completed payment.
     *
     * <p>Uses a single atomic {@code UPDATE ... WHERE status = PENDING_PAYMENT}
     * (see {@link com.smartlaundromat.machine.repository.ReservationRepository#cancelStalePendingHolds})
     * rather than a read-then-save loop: a read-then-write here would race
     * {@link #activateByReference} — the row could be activated (paid) between this
     * sweep's read and its write, and a blind save would silently cancel an
     * already-paid reservation. The atomic UPDATE's WHERE clause makes it a no-op
     * for any row that has left PENDING_PAYMENT by the time it runs.
     */
    @Scheduled(fixedDelayString = "${reservation.hold-check-ms:60000}")
    @Transactional
    public void releaseExpiredHolds() {
        if (!isEnabled()) return;
        LocalDateTime cutoff = LocalDateTime.now().minusMinutes(reservationProperties.getHoldTimeoutMinutes());
        int released = reservationRepository.cancelStalePendingHolds(cutoff);
        if (released > 0) {
            log.info("Released {} unpaid reservation hold(s)", released);
        }
    }

    // ── Internals ─────────────────────────────────────────────────────────────────

    private ReservationResponse toResponse(Reservation r, String message) {
        String name = machineRepository.findByMachineId(r.getMachineId())
                .map(Machine::getDisplayName).orElse(r.getMachineId());
        return buildResponse(r, name, message);
    }

    // com.smartlaundromat.contracts.reservation.ReservationStatus is qualified inline rather
    // than imported (R8): its simple name collides with this file's own
    // com.smartlaundromat.machine.model.enums.ReservationStatus, which every other method
    // here uses far more often — only this one conversion point needs the wire enum.
    private ReservationResponse buildResponse(Reservation r, String machineName, String message) {
        return new ReservationResponse(
                r.getReservationCode(),
                r.getMachineId(),
                machineName,
                r.getCustomerPhone(),
                r.getSlotStart(),
                r.getSlotEnd(),
                com.smartlaundromat.contracts.reservation.ReservationStatus.valueOf(r.getStatus().name()),
                r.getFeeAmount(),
                r.getCurrency(),
                r.getTransactionReference(),
                message);
    }

    private String generateUniqueCode() {
        for (int attempt = 0; attempt < 20; attempt++) {
            StringBuilder sb = new StringBuilder(reservationProperties.getCodePrefix());
            for (int i = 0; i < reservationProperties.getCodeLength(); i++) {
                sb.append(CODE_ALPHABET[RANDOM.nextInt(CODE_ALPHABET.length)]);
            }
            String code = sb.toString();
            if (!reservationRepository.existsByReservationCode(code)) {
                return code;
            }
        }
        throw new ReservationException("Could not generate a unique reservation code");
    }
}
