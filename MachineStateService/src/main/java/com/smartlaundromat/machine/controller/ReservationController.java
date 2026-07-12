package com.smartlaundromat.machine.controller;

import com.smartlaundromat.machine.dto.*;
import com.smartlaundromat.machine.model.Reservation;
import com.smartlaundromat.machine.service.ReservationService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

/**
 * Reservation endpoints (active only when {@code features.reservation-enabled=true}).
 *
 * <table>
 *   <tr><th>Method</th><th>Path</th><th>Purpose</th><th>Scope</th></tr>
 *   <tr><td>POST</td><td>/api/reservations</td><td>Create a 1-hour reservation (PENDING_PAYMENT)</td><td>sls-reservation-write</td></tr>
 *   <tr><td>POST</td><td>/api/reservations/activate</td><td>Activate after fee payment confirmed</td><td>sls-reservation-write</td></tr>
 *   <tr><td>POST</td><td>/api/reservations/cancel</td><td>Release a PENDING_PAYMENT hold (payment failed/abandoned)</td><td>sls-reservation-write</td></tr>
 *   <tr><td>POST</td><td>/api/reservations/validate</td><td>Cross-check code + machine</td><td>sls-reservation-read</td></tr>
 *   <tr><td>GET</td><td>/api/reservations/conflicts</td><td>Duration-aware overlap check for a machine</td><td>sls-reservation-read</td></tr>
 *   <tr><td>GET</td><td>/api/reservations/{code}</td><td>Fetch a reservation by code</td><td>sls-reservation-read</td></tr>
 *   <tr><td>GET</td><td>/api/reservations/machine/{machineId}</td><td>List a machine's reservations</td><td>sls-reservation-read</td></tr>
 *   <tr><td>GET</td><td>/api/reservations/customer/{phone}</td><td>List a customer's held reservations</td><td>sls-reservation-read</td></tr>
 * </table>
 */
@Slf4j
@RestController
@RequestMapping("/api/reservations")
@RequiredArgsConstructor
public class ReservationController {

    private final ReservationService reservationService;

    @PostMapping
    public ResponseEntity<ReservationResponse> create(@Valid @RequestBody CreateReservationRequest request) {
        log.info("Received request to create reservation for machineId={}, slotStart={}",
                request.getMachineId(), request.getSlotStart());
        return ResponseEntity.ok(reservationService.createReservation(request));
    }

    @PostMapping("/activate")
    public ResponseEntity<ReservationResponse> activate(@Valid @RequestBody ActivateReservationRequest request) {
        log.info("Received request to activate reservation with transactionReference={}", request.getTransactionReference());
        return ResponseEntity.ok(reservationService.activateByReference(request.getTransactionReference()));
    }

    @PostMapping("/cancel")
    public ResponseEntity<ReservationResponse> cancel(@Valid @RequestBody ActivateReservationRequest request) {
        log.info("Received request to cancel reservation with transactionReference={}", request.getTransactionReference());
        return ResponseEntity.ok(reservationService.cancel(request.getTransactionReference()));
    }

    @PostMapping("/validate")
    public ResponseEntity<ValidateReservationResponse> validate(
            @Valid @RequestBody ValidateReservationRequest request) {
        log.info("Received request to validate reservation with reservationCode={} and machineId={}",
                request.getReservationCode(), request.getMachineId());
        return ResponseEntity.ok(
                reservationService.validate(request.getReservationCode(), request.getMachineId()));
    }

    /**
     * Checks whether a machine has a reservation (PENDING_PAYMENT or ACTIVE) overlapping the
     * half-open window {@code [now, now + durationMinutes)}, other than {@code reservationCode}
     * if supplied. Used by PaymentManagementService to reject a walk-in whose chosen cycle
     * duration would run into an upcoming reservation, before charging.
     */
    @GetMapping("/conflicts")
    public ResponseEntity<ReservationConflictResponse> checkConflict(
            @RequestParam String machineId,
            @RequestParam int durationMinutes,
            @RequestParam(required = false) String reservationCode) {
        if (durationMinutes <= 0) {
            throw new IllegalArgumentException("durationMinutes must be positive: " + durationMinutes);
        }
        LocalDateTime now = LocalDateTime.now();
        Optional<Reservation> conflicting = reservationService.findConflicting(
                machineId, now, now.plusMinutes(durationMinutes), reservationCode);
        return ResponseEntity.ok(ReservationConflictResponse.from(conflicting));
    }

    @GetMapping("/{code}")
    public ResponseEntity<ReservationResponse> getByCode(@PathVariable String code) {
        log.info("Received request to fetch reservation with code={}", code);
        return ResponseEntity.ok(reservationService.getByCode(code));
    }

    @GetMapping("/machine/{machineId}")
    public ResponseEntity<List<Reservation>> listForMachine(@PathVariable String machineId) {
        log.info("Received request to list reservations for machineId={}", machineId);
        return ResponseEntity.ok(reservationService.listForMachine(machineId));
    }

    @GetMapping("/customer/{phone}")
    public ResponseEntity<List<Reservation>> listHeldForCustomer(@PathVariable String phone) {
        log.info("Received request to list held reservations for customerPhone={}", phone);
        return ResponseEntity.ok(reservationService.listHeldForCustomer(phone));
    }
}
