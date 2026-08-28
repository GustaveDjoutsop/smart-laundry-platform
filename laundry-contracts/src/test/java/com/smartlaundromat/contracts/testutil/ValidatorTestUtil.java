package com.smartlaundromat.contracts.testutil;

import jakarta.validation.Validation;
import jakarta.validation.Validator;
import org.hibernate.validator.messageinterpolation.ParameterMessageInterpolator;

public final class ValidatorTestUtil {

    // ParameterMessageInterpolator avoids the default ResourceBundleMessageInterpolator's
    // EL requirement (HV000183) — this module has no EL implementation on the classpath by
    // design, and none of these DTOs' messages use EL syntax anyway. Spring Boot's
    // LocalValidatorFactoryBean makes this same choice by default in every consuming service.
    private static final Validator VALIDATOR = Validation.byDefaultProvider()
            .configure()
            .messageInterpolator(new ParameterMessageInterpolator())
            .buildValidatorFactory()
            .getValidator();

    public static Validator validator() {
        return VALIDATOR;
    }

    private ValidatorTestUtil() {
    }
}
