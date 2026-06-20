package com.botmanager.core.i18n;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import static org.assertj.core.api.Assertions.assertThat;

class LanguageTest {

    @ParameterizedTest
    @CsvSource({
            "en, EN",
            "EN, EN",
            "En, EN",
            "fr, FR",
            "FR, FR",
            "Fr, FR"
    })
    void shouldParseFromCodeCaseInsensitively(String code, String expectedName) {
        // when
        Language result = Language.fromCode(code);

        // then
        assertThat(result).isEqualTo(Language.valueOf(expectedName));
    }

    @Test
    void shouldReturnEnglishForNullCode() {
        // when
        Language result = Language.fromCode(null);

        // then
        assertThat(result).isEqualTo(Language.EN);
    }

    @Test
    void shouldReturnEnglishForUnknownCode() {
        // when
        Language result = Language.fromCode("de");

        // then
        assertThat(result).isEqualTo(Language.EN);
    }

    @Test
    void shouldReturnCorrectJsonCode() {
        // then
        assertThat(Language.EN.getCode()).isEqualTo("en");
        assertThat(Language.FR.getCode()).isEqualTo("fr");
    }

}
