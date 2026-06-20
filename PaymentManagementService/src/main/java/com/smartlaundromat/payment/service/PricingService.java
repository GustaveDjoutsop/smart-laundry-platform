package com.smartlaundromat.payment.service;

import com.smartlaundromat.payment.model.Pricing;
import com.smartlaundromat.payment.repository.PricingRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.List;

@Service
@Slf4j
@RequiredArgsConstructor
public class PricingService {

    private final PricingRepository pricingRepository;

    public List<Pricing> getAll() {
        return pricingRepository.findAll();
    }

    @Transactional
    public Pricing update(String key, int amount, String updatedBy) {
        Pricing pricing = pricingRepository.findById(key)
                .orElseThrow(() -> new IllegalArgumentException("Unknown pricing key: " + key));
        int previous = pricing.getAmount();
        pricing.setAmount(amount);
        pricing.setUpdatedAt(OffsetDateTime.now());
        pricing.setUpdatedBy(updatedBy);
        Pricing saved = pricingRepository.save(pricing);
        log.info("Pricing updated: key={} old={} new={} by={}", key, previous, amount, updatedBy);
        return saved;
    }
}
