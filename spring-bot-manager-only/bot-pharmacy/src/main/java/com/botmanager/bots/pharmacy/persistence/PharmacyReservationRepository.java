package com.botmanager.bots.pharmacy.persistence;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface PharmacyReservationRepository extends JpaRepository<PharmacyReservation, UUID> {

    List<PharmacyReservation> findByCustomerPhoneAndStatus(String customerPhone, String status);

}
