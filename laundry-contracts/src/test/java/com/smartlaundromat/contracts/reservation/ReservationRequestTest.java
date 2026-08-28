package com.smartlaundromat.contracts.reservation;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.Set;

import static com.smartlaundromat.contracts.testutil.ValidatorTestUtil.validator;
import static org.assertj.core.api.Assertions.assertThat;

class ReservationRequestTest {

    private final Validator validator = validator();

    @Test
    void shouldHaveNoViolationsWhenMachineIdAndSlotStartPresent() {
        // given
        ReservationRequest request = new ReservationRequest(
                "washer_01", "+237690000000", LocalDateTime.now().plusHours(1));

        // when
        Set<ConstraintViolation<ReservationRequest>> violations = validator.validate(request);

        // then
        assertThat(violations).isEmpty();
    }

    @Test
    void shouldAllowMissingCustomerPhoneBecauseItIsInformationalOnly() {
        // given
        ReservationRequest request = new ReservationRequest(
                "washer_01", null, LocalDateTime.now().plusHours(1));

        // when
        Set<ConstraintViolation<ReservationRequest>> violations = validator.validate(request);

        // then
        assertThat(violations).isEmpty();
    }

    @Test
    void shouldReportViolationsWhenMachineIdAndSlotStartMissing() {
        // given
        ReservationRequest request = new ReservationRequest("", "+237690000000", null);

        // when
        Set<ConstraintViolation<ReservationRequest>> violations = validator.validate(request);

        // then
        assertThat(violations)
                .extracting(ConstraintViolation::getPropertyPath)
                .extracting(Object::toString)
                .containsExactlyInAnyOrder("machineId", "slotStart");
    }
}
