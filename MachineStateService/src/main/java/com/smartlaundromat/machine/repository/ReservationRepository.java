package com.smartlaundromat.machine.repository;

import com.smartlaundromat.machine.model.Reservation;
import com.smartlaundromat.machine.model.enums.ReservationStatus;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
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

    /**
     * Locks the reservation row for the duration of the caller's transaction, so a
     * status read-then-write (activate/cancel) can't race a concurrent activate,
     * cancel, or the hold-expiry sweep on the same reservation.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT r FROM Reservation r WHERE r.transactionReference = :transactionReference")
    Optional<Reservation> findByTransactionReferenceForUpdate(
            @Param("transactionReference") String transactionReference);

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

    List<Reservation> findByStatusAndCreatedAtBefore(ReservationStatus status, LocalDateTime cutoff);

    /**
     * Atomically cancels stale unpaid holds in a single UPDATE, guarded by
     * {@code status = PENDING_PAYMENT} at the database level. Deliberately not a
     * read-then-save loop: a plain SELECT-then-modify here would race a concurrent
     * {@code activateByReference}/{@code cancel} call — this row could flip to ACTIVE
     * between the sweep's read and its write, and a blind save would silently
     * clobber a just-activated (paid) reservation back to CANCELLED. The WHERE
     * clause makes this a no-op for any row that has since left PENDING_PAYMENT,
     * so there's no read-then-write window to race at all.
     *
     * @return number of holds released
     */
    @Modifying
    @Query("""
           UPDATE Reservation r SET r.status = com.smartlaundromat.machine.model.enums.ReservationStatus.CANCELLED
           WHERE r.status = com.smartlaundromat.machine.model.enums.ReservationStatus.PENDING_PAYMENT
             AND r.createdAt < :cutoff
           """)
    int cancelStalePendingHolds(@Param("cutoff") LocalDateTime cutoff);

    /**
     * ACTIVE reservations whose slot starts within the reminder window and haven't
     * been reminded yet. Bounded by {@code slotStart <= cutoff} (cutoff = now +
     * reminderMinutesBefore) rather than an unbounded scan of all ACTIVE rows.
     */
    List<Reservation> findByStatusAndReminderSentAtIsNullAndSlotStartBefore(
            ReservationStatus status, LocalDateTime cutoff);
}
