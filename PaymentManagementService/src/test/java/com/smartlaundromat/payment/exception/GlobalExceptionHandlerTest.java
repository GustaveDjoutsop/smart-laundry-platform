package com.smartlaundromat.payment.exception;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.BeanPropertyBindingResult;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class GlobalExceptionHandlerTest {

    GlobalExceptionHandler handler;

    @BeforeEach
    void setUp() {
        handler = new GlobalExceptionHandler();
    }

    @Test
    void shouldHandleCardNotFoundException() {
        // given
        CardNotFoundException ex = new CardNotFoundException("Card not found: ABC");

        // when
        ResponseEntity<Map<String, Object>> response = handler.handleCardNotFound(ex);

        // then
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(response.getBody()).containsEntry("error", "CARD_NOT_FOUND");
        assertThat(response.getBody()).containsEntry("message", "Card not found: ABC");
    }

    @Test
    void shouldHandleInsufficientBalanceException() {
        // given
        InsufficientBalanceException ex = new InsufficientBalanceException("Not enough money");

        // when
        ResponseEntity<Map<String, Object>> response = handler.handleInsufficientBalance(ex);

        // then
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).containsEntry("error", "INSUFFICIENT_BALANCE");
    }

    @Test
    void shouldHandlePaymentException() {
        // given
        PaymentException ex = new PaymentException("MACHINE_BUSY", "Machine is busy");

        // when
        ResponseEntity<Map<String, Object>> response = handler.handlePaymentError(ex);

        // then
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).containsEntry("error", "MACHINE_BUSY");
        assertThat(response.getBody()).containsEntry("message", "Machine is busy");
    }

    @Test
    void shouldHandlePaymentExceptionWithDefaultErrorCode() {
        // given
        PaymentException ex = new PaymentException("Some error");

        // when / then
        assertThat(ex.getErrorCode()).isEqualTo("PAYMENT_ERROR");
    }

    @Test
    void shouldHandleValidationException() throws Exception {
        // given
        BeanPropertyBindingResult bindingResult = new BeanPropertyBindingResult(new Object(), "request");
        bindingResult.addError(new FieldError("request", "cardUid", "Card UID is required"));

        MethodArgumentNotValidException ex = new MethodArgumentNotValidException(
                new org.springframework.core.MethodParameter(
                        this.getClass().getDeclaredMethod("shouldHandleValidationException"), -1),
                bindingResult);

        // when
        ResponseEntity<Map<String, Object>> response = handler.handleValidation(ex);

        // then
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).containsEntry("error", "VALIDATION_ERROR");
        assertThat(response.getBody()).containsKey("details");
    }

    @Test
    void shouldHandleGenericException() {
        // given
        Exception ex = new RuntimeException("Unexpected error");

        // when
        ResponseEntity<Map<String, Object>> response = handler.handleGeneral(ex);

        // then
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
        assertThat(response.getBody()).containsEntry("error", "INTERNAL_ERROR");
    }
}
