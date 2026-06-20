package com.smartlaundromat.payment.controller;

import com.smartlaundromat.payment.dto.*;
import com.smartlaundromat.payment.model.RfidCard;
import com.smartlaundromat.payment.service.RfidCardService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/rfid")
@RequiredArgsConstructor
public class RfidCardController {

    private final RfidCardService rfidCardService;

    @PostMapping("/register")
    public ResponseEntity<RfidCard> registerCard(@Valid @RequestBody RfidCardRegistrationRequest request) {
        RfidCard card = rfidCardService.registerCard(request);
        return ResponseEntity.status(HttpStatus.CREATED).body(card);
    }

    @GetMapping("/balance/{cardUid}")
    public ResponseEntity<RfidBalanceResponse> checkBalance(
            @PathVariable String cardUid,
            @RequestParam(required = false) BigDecimal requiredAmount) {
        RfidBalanceResponse response = rfidCardService.checkBalance(cardUid, requiredAmount);
        return ResponseEntity.ok(response);
    }

    @PostMapping("/debit")
    public ResponseEntity<TransactionDebitResponse> debitCard(@Valid @RequestBody RfidDebitRequest request) {
        TransactionDebitResponse response = rfidCardService.debitCard(
                request.getCardUid(),
                request.getAmount(),
                request.getMachineId(),
                request.getPulseCount(),
                request.getCycleDuration(),
                request.getDescription()
        );
        return ResponseEntity.ok(response);
    }

    @GetMapping("/cards")
    public ResponseEntity<List<RfidCard>> getAllCards() {
        return ResponseEntity.ok(rfidCardService.getAllCards());
    }

    @GetMapping("/cards/{cardUid}")
    public ResponseEntity<RfidCard> getCard(@PathVariable String cardUid) {
        return ResponseEntity.ok(rfidCardService.getCardByUid(cardUid));
    }

    @PatchMapping("/cards/{cardUid}/deactivate")
    public ResponseEntity<RfidCard> deactivateCard(@PathVariable String cardUid) {
        return ResponseEntity.ok(rfidCardService.deactivateCard(cardUid));
    }

    @PatchMapping("/cards/{cardUid}/activate")
    public ResponseEntity<RfidCard> activateCard(@PathVariable String cardUid) {
        return ResponseEntity.ok(rfidCardService.activateCard(cardUid));
    }
}
