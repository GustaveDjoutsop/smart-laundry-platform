package com.botmanager.bots.pharmacy;

import com.botmanager.bots.pharmacy.persistence.PharmacyProduct;
import com.botmanager.bots.pharmacy.persistence.PharmacyProductRepository;
import com.botmanager.bots.pharmacy.persistence.PharmacyReservation;
import com.botmanager.bots.pharmacy.persistence.PharmacyReservationRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Slf4j
@Service
@RequiredArgsConstructor
public class InventoryService {

    private static final int RESERVATION_EXPIRY_HOURS = 24;

    private final PharmacyProductRepository productRepository;

    private final PharmacyReservationRepository reservationRepository;

    public List<PharmacyProduct> searchProducts(String query) {
        return productRepository.findByNameContainingIgnoreCaseAndActiveTrue(query);
    }

    public List<PharmacyProduct> getAvailableProducts() {
        return productRepository.findByActiveTrueAndStockGreaterThan(0);
    }

    public Optional<PharmacyProduct> getProduct(UUID productId) {
        return productRepository.findById(productId);
    }

    @Transactional
    public Optional<PharmacyReservation> reserveProduct(UUID productId, String customerPhone,
                                                        int quantity) {
        Optional<PharmacyProduct> productOpt = productRepository.findById(productId);
        if (productOpt.isEmpty()) {
            return Optional.empty();
        }

        PharmacyProduct product = productOpt.get();
        if (product.getStock() < quantity) {
            return Optional.empty();
        }

        product.setStock(product.getStock() - quantity);
        product.setUpdatedAt(Instant.now());
        productRepository.save(product);

        PharmacyReservation reservation = new PharmacyReservation();
        reservation.setProduct(product);
        reservation.setCustomerPhone(customerPhone);
        reservation.setQuantity(quantity);
        reservation.setStatus("PENDING");
        reservation.setExpiresAt(Instant.now().plus(RESERVATION_EXPIRY_HOURS, ChronoUnit.HOURS));

        return Optional.of(reservationRepository.save(reservation));
    }

    @Transactional
    public boolean confirmReservation(UUID reservationId) {
        Optional<PharmacyReservation> reservationOpt = reservationRepository.findById(reservationId);
        if (reservationOpt.isEmpty()) {
            return false;
        }

        PharmacyReservation reservation = reservationOpt.get();
        if (!"PENDING".equals(reservation.getStatus())) {
            return false;
        }

        reservation.setStatus("CONFIRMED");
        reservation.setUpdatedAt(Instant.now());
        reservationRepository.save(reservation);
        return true;
    }

    @Transactional
    public boolean cancelReservation(UUID reservationId) {
        Optional<PharmacyReservation> reservationOpt = reservationRepository.findById(reservationId);
        if (reservationOpt.isEmpty()) {
            return false;
        }

        PharmacyReservation reservation = reservationOpt.get();
        if (!"PENDING".equals(reservation.getStatus())) {
            return false;
        }

        reservation.setStatus("CANCELLED");
        reservation.setUpdatedAt(Instant.now());
        reservationRepository.save(reservation);

        PharmacyProduct product = reservation.getProduct();
        product.setStock(product.getStock() + reservation.getQuantity());
        product.setUpdatedAt(Instant.now());
        productRepository.save(product);

        return true;
    }

    public List<PharmacyReservation> getActiveReservations(String customerPhone) {
        return reservationRepository.findByCustomerPhoneAndStatus(customerPhone, "PENDING");
    }

}
