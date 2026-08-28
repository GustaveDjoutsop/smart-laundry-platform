package com.smartlaundromat.contracts.machine;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;
import org.junit.jupiter.api.Test;

import java.util.Set;

import static com.smartlaundromat.contracts.testutil.ValidatorTestUtil.validator;
import static org.assertj.core.api.Assertions.assertThat;

class MachineStartRequestTest {

    private final Validator validator = validator();

    @Test
    void shouldHaveNoViolationsWhenAllRequiredFieldsPresent() {
        // given
        MachineStartRequest request = new MachineStartRequest(
                "washer_01", "NORMAL", 30, 1, "tx-123", null, null);

        // when
        Set<ConstraintViolation<MachineStartRequest>> violations = validator.validate(request);

        // then
        assertThat(violations).isEmpty();
    }

    @Test
    void shouldReportViolationsWhenMachineIdCycleTypeDurationAndPulseCountMissing() {
        // given
        MachineStartRequest request = new MachineStartRequest(
                " ", "", null, null, null, null, null);

        // when
        Set<ConstraintViolation<MachineStartRequest>> violations = validator.validate(request);

        // then
        assertThat(violations)
                .extracting(ConstraintViolation::getPropertyPath)
                .extracting(Object::toString)
                .containsExactlyInAnyOrder("machineId", "cycleType", "durationMinutes", "pulseCount");
    }
}
