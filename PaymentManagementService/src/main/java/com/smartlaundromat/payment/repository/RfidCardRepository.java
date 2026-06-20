package com.smartlaundromat.payment.repository;

import com.smartlaundromat.payment.model.RfidCard;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface RfidCardRepository extends JpaRepository<RfidCard, Long> {

    Optional<RfidCard> findByCardUid(String cardUid);

    boolean existsByCardUid(String cardUid);
}
