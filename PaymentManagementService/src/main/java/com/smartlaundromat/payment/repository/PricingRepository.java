package com.smartlaundromat.payment.repository;

import com.smartlaundromat.payment.model.Pricing;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PricingRepository extends JpaRepository<Pricing, String> {
}
