package com.smartlaundromat.contracts.payment;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.Set;

import static com.smartlaundromat.contracts.testutil.ValidatorTestUtil.validator;
import static org.assertj.core.api.Assertions.assertThat;

class PaymentInitiateRequestTest {

    private final Validator validator = validator();

    @Test
    void shouldHaveNoViolationsWhenAllRequiredFieldsPresent() {
        // given
        PaymentInitiateRequest request = new PaymentInitiateRequest(
                "+237690000000", BigDecimal.valueOf(1000), "washer_01", 1, 30,
                PaymentProvider.CAMPAY, null, null, false, null);

        // when
        Set<ConstraintViolation<PaymentInitiateRequest>> violations = validator.validate(request);

        // then
        assertThat(violations).isEmpty();
    }

    @Test
    void shouldReportViolationWhenAmountIsNotPositive() {
        // given
        PaymentInitiateRequest request = new PaymentInitiateRequest(
                "+237690000000", BigDecimal.ZERO, "washer_01", 1, 30,
                PaymentProvider.CAMPAY, null, null, false, null);

        // when
        Set<ConstraintViolation<PaymentInitiateRequest>> violations = validator.validate(request);

        // then
        assertThat(violations)
                .extracting(ConstraintViolation::getPropertyPath)
                .extracting(Object::toString)
                .containsExactly("amount");
    }

    @Test
    void shouldReportViolationWhenIdempotencyKeyExceedsFiftyCharacters() {
        // given
        String tooLong = "k".repeat(51);
        PaymentInitiateRequest request = new PaymentInitiateRequest(
                "+237690000000", BigDecimal.valueOf(1000), "washer_01", 1, 30,
                PaymentProvider.CAMPAY, null, null, false, tooLong);

        // when
        Set<ConstraintViolation<PaymentInitiateRequest>> violations = validator.validate(request);

        // then
        assertThat(violations)
                .extracting(ConstraintViolation::getPropertyPath)
                .extracting(Object::toString)
                .containsExactly("idempotencyKey");
    }

    @Test
    void shouldReportViolationsWhenRequiredFieldsMissing() {
        // given
        PaymentInitiateRequest request = new PaymentInitiateRequest(
                "", null, "", null, null, null, null, null, false, null);

        // when
        Set<ConstraintViolation<PaymentInitiateRequest>> violations = validator.validate(request);

        // then
        assertThat(violations)
                .extracting(ConstraintViolation::getPropertyPath)
                .extracting(Object::toString)
                .containsExactlyInAnyOrder(
                        "phoneNumber", "amount", "machineId", "pulseCount", "cycleDuration", "provider");
    }
}
