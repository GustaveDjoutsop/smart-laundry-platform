package com.smartlaundromat.machine.repository;

import com.smartlaundromat.machine.model.Reservation;
import com.smartlaundromat.machine.model.enums.ReservationStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Repository
public interface ReservationRepository extends JpaRepository<Reservation, Long> {

    /**
     * The authorization lookup: cross-check by CODE + MACHINE only (never by user).
     */
    Optional<Reservation> findByReservationCodeAndMachineId(String reservationCode, String machineId);

    Optional<Reservation> findByReservationCode(String reservationCode);

    Optional<Reservation> findByTransactionReference(String transactionReference);

    boolean existsByReservationCode(String reservationCode);

    List<Reservation> findByMachineIdAndStatus(String machineId, ReservationStatus status);

    List<Reservation> findByMachineIdOrderBySlotStartDesc(String machineId);

    /**
     * Finds reservations for a machine that overlap the half-open interval
     * {@code [start, end)} and are still holding the slot (PENDING_PAYMENT or ACTIVE).
     * Two intervals overlap when {@code existingStart < end AND existingEnd > start}.
     */
    @Query("""
           SELECT r FROM Reservation r
           WHERE r.machineId = :machineId
             AND r.status IN (com.smartlaundromat.machine.model.enums.ReservationStatus.PENDING_PAYMENT,
                              com.smartlaundromat.machine.model.enums.ReservationStatus.ACTIVE)
             AND r.slotStart < :end
             AND r.slotEnd   > :start
           """)
    List<Reservation> findOverlapping(@Param("machineId") String machineId,
                                      @Param("start") LocalDateTime start,
                                      @Param("end") LocalDateTime end);

    /**
     * Active reservation currently covering {@code now} for a machine, if any.
     */
    @Query("""
           SELECT r FROM Reservation r
           WHERE r.machineId = :machineId
             AND r.status = com.smartlaundromat.machine.model.enums.ReservationStatus.ACTIVE
             AND r.slotStart <= :now
             AND r.slotEnd   >  :now
           """)
    Optional<Reservation> findActiveCovering(@Param("machineId") String machineId,
                                             @Param("now") LocalDateTime now);

    /**
     * Reservations whose slot has ended but are still PENDING_PAYMENT or ACTIVE — to expire.
     */
    @Query("""
           SELECT r FROM Reservation r
           WHERE r.status IN (com.smartlaundromat.machine.model.enums.ReservationStatus.PENDING_PAYMENT,
                              com.smartlaundromat.machine.model.enums.ReservationStatus.ACTIVE)
             AND r.slotEnd <= :now
           """)
    List<Reservation> findExpirable(@Param("now") LocalDateTime now);
}
