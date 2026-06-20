package com.smartlaundromat.payment.controller;

import com.smartlaundromat.payment.dto.PricingResponse;
import com.smartlaundromat.payment.dto.PricingUpdateRequest;
import com.smartlaundromat.payment.model.Pricing;
import com.smartlaundromat.payment.service.PricingService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/pricing")
@RequiredArgsConstructor
public class PricingController {

    private final PricingService pricingService;

    @GetMapping
    public List<PricingResponse> getAll() {
        return pricingService.getAll().stream()
                .map(PricingResponse::from)
                .toList();
    }

    @PutMapping("/{key}")
    public ResponseEntity<PricingResponse> update(
            @PathVariable String key,
            @Valid @RequestBody PricingUpdateRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        String caller = jwt != null ? jwt.getSubject() : "system";
        Pricing updated = pricingService.update(key, request.amount(), caller);
        return ResponseEntity.ok(PricingResponse.from(updated));
    }
}
