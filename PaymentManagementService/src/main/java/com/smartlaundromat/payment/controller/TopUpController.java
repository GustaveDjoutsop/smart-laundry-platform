package com.smartlaundromat.payment.controller;

import com.smartlaundromat.payment.dto.TopUpRequest;
import com.smartlaundromat.payment.dto.TopUpResponse;
import com.smartlaundromat.payment.model.TopUpTransaction;
import com.smartlaundromat.payment.service.TopUpService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/topup")
@RequiredArgsConstructor
public class TopUpController {

    private final TopUpService topUpService;

    @PostMapping
    public ResponseEntity<TopUpResponse> initiateTopUp(@Valid @RequestBody TopUpRequest request) {
        TopUpResponse response = topUpService.initiateTopUp(request);
        return ResponseEntity.ok(response);
    }

    @GetMapping("/history/{cardUid}")
    public ResponseEntity<List<TopUpTransaction>> getTopUpHistory(@PathVariable String cardUid) {
        return ResponseEntity.ok(topUpService.getTopUpHistory(cardUid));
    }
}
