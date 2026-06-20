package com.smartlaundromat.payment.controller;

import com.smartlaundromat.payment.dto.PaymentInitiationRequest;
import com.smartlaundromat.payment.dto.PaymentResponse;
import com.smartlaundromat.payment.model.Transaction;
import com.smartlaundromat.payment.service.PaymentService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@Slf4j
@RestController
@RequestMapping("/api/payments")
@RequiredArgsConstructor
public class PaymentController {

    private final PaymentService paymentService;

    @PostMapping("/initiate")
    public ResponseEntity<PaymentResponse> initiatePayment(@Valid @RequestBody PaymentInitiationRequest request) {
        log.info("Initiating payment for request: {}", request);
        PaymentResponse response = paymentService.initiatePayment(request);
        log.info("Payment initiated successfully: {}", response);
        return ResponseEntity.ok(response);
    }

    @GetMapping("/transaction/{reference}")
    public ResponseEntity<Transaction> getTransaction(@PathVariable String reference) {
        log.info("Fetching transaction with reference: {}", reference);
        Transaction transaction = paymentService.getTransactionByReference(reference);
        log.info("Transaction fetched successfully: {}", transaction);
        return ResponseEntity.ok(transaction);
    }

    @GetMapping("/machine/{machineId}")
    public ResponseEntity<List<Transaction>> getTransactionsByMachine(@PathVariable String machineId) {
        log.info("Fetching transactions for machine with ID: {}", machineId);
        List<Transaction> transactions = paymentService.getTransactionsByMachine(machineId);
        log.info("Transactions fetched successfully: {}", transactions);
        return ResponseEntity.ok(transactions);
    }

    @GetMapping("/card/{cardUid}")
    public ResponseEntity<List<Transaction>> getTransactionsByCard(@PathVariable String cardUid) {
        return ResponseEntity.ok(paymentService.getTransactionsByCard(cardUid));
    }

    @GetMapping("/providers/status")
    public ResponseEntity<Map<String, Object>> getProviderStatus() {
        return ResponseEntity.ok(paymentService.getProviderStatus());
    }
}
