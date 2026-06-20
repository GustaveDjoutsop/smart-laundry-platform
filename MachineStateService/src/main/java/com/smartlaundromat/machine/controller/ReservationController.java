package com.smartlaundromat.machine.controller;

import com.smartlaundromat.machine.dto.*;
import com.smartlaundromat.machine.model.Reservation;
import com.smartlaundromat.machine.service.ReservationService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * Reservation endpoints (active only when {@code features.reservation-enabled=true}).
 *
 * <table>
 *   <tr><th>Method</th><th>Path</th><th>Purpose</th><th>Scope</th></tr>
 *   <tr><td>POST</td><td>/api/reservations</td><td>Create a 1-hour reservation (PENDING_PAYMENT)</td><td>sls-reservation-write</td></tr>
 *   <tr><td>POST</td><td>/api/reservations/activate</td><td>Activate after fee payment confirmed</td><td>sls-reservation-write</td></tr>
 *   <tr><td>POST</td><td>/api/reservations/validate</td><td>Cross-check code + machine</td><td>sls-reservation-read</td></tr>
 *   <tr><td>GET</td><td>/api/reservations/{code}</td><td>Fetch a reservation by code</td><td>sls-reservation-read</td></tr>
 *   <tr><td>GET</td><td>/api/reservations/machine/{machineId}</td><td>List a machine's reservations</td><td>sls-reservation-read</td></tr>
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

    @PostMapping("/validate")
    public ResponseEntity<ValidateReservationResponse> validate(
            @Valid @RequestBody ValidateReservationRequest request) {
        log.info("Received request to validate reservation with reservationCode={} and machineId={}",
                request.getReservationCode(), request.getMachineId());
        return ResponseEntity.ok(
                reservationService.validate(request.getReservationCode(), request.getMachineId()));
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
}
