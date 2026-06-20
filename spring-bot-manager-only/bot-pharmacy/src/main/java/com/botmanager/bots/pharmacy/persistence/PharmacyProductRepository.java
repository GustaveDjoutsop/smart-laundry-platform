package com.botmanager.bots.pharmacy.persistence;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface PharmacyProductRepository extends JpaRepository<PharmacyProduct, UUID> {

    List<PharmacyProduct> findByNameContainingIgnoreCaseAndActiveTrue(String name);

    List<PharmacyProduct> findByActiveTrueAndStockGreaterThan(int minStock);

}
