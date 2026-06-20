package com.smartlaundromat.machine.service;

import com.smartlaundromat.machine.client.PricingClient;
import com.smartlaundromat.machine.config.FeatureProperties;
import com.smartlaundromat.machine.config.ReservationProperties;
import com.smartlaundromat.machine.dto.*;
import com.smartlaundromat.machine.exception.MachineNotFoundException;
import com.smartlaundromat.machine.exception.ReservationException;
import com.smartlaundromat.machine.model.Machine;
import com.smartlaundromat.machine.model.Reservation;
import com.smartlaundromat.machine.model.enums.ReservationStatus;
import com.smartlaundromat.machine.repository.MachineRepository;
import com.smartlaundromat.machine.repository.ReservationRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.LocalDateTime;
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
    public ReservationResponse createReservation(CreateReservationRequest request) {
        requireEnabled();

        Machine machine = machineRepository.findByMachineId(request.getMachineId())
                .orElseThrow(() -> new MachineNotFoundException(
                        "Machine not found: " + request.getMachineId()));

        LocalDateTime start = request.getSlotStart();
        if (start == null) {
            throw new ReservationException("Slot start is required");
        }
        if (start.isBefore(LocalDateTime.now().minusMinutes(1))) {
            throw new ReservationException("Slot start must not be in the past");
        }
        // Slot is ALWAYS exactly one hour — not less, not more.
        LocalDateTime end = start.plusMinutes(ReservationProperties.SLOT_MINUTES);

        List<Reservation> overlapping = reservationRepository.findOverlapping(
                request.getMachineId(), start, end);
        if (!overlapping.isEmpty()) {
            throw new ReservationException(
                    "Machine " + request.getMachineId() + " is already reserved for that time slot");
        }

        String code = generateUniqueCode();
        String reference = "RESV-" + request.getMachineId() + "-" + System.currentTimeMillis();

        Reservation reservation = Reservation.builder()
                .reservationCode(code)
                .machineId(request.getMachineId())
                .customerPhone(request.getCustomerPhone())
                .slotStart(start)
                .slotEnd(end)
                .status(ReservationStatus.PENDING_PAYMENT)
                .feeAmount(pricingClient.getReservationFee())
                .currency(reservationProperties.getCurrency())
                .transactionReference(reference)
                .build();
        reservationRepository.save(reservation);

        log.info("Reservation created: code={} machine={} slot={}..{} fee={} {} ref={}",
                code, request.getMachineId(), start, end,
                reservation.getFeeAmount(), reservation.getCurrency(), reference);

        return ReservationResponse.from(reservation, machine.getDisplayName(),
                "Reservation created. Pay the reservation fee to activate it, then send the code to run the machine.");
    }

    // ── Activate (on payment confirmation) ──────────────────────────────────────

    @Transactional
    public ReservationResponse activateByReference(String transactionReference) {
        requireEnabled();
        Reservation reservation = reservationRepository.findByTransactionReference(transactionReference)
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

    // ── Internals ─────────────────────────────────────────────────────────────────

    private ReservationResponse toResponse(Reservation r, String message) {
        String name = machineRepository.findByMachineId(r.getMachineId())
                .map(Machine::getDisplayName).orElse(r.getMachineId());
        return ReservationResponse.from(r, name, message);
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
