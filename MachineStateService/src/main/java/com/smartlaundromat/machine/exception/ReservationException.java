package com.smartlaundromat.machine.exception;

/**
 * Thrown when a reservation operation is invalid (feature disabled, slot conflict,
 * invalid code, expired/used reservation, etc.).
 */
public class ReservationException extends RuntimeException {
    public ReservationException(String message) {
        super(message);
    }
}
