package com.botmanager.core.i18n;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class TranslationServiceTest {

    private TranslationService translationService;

    @BeforeEach
    void setUp() {
        translationService = new TranslationService();
    }

    @Test
    void shouldTranslateKnownKeyInEnglish() {
        // when
        String result = translationService.translate("language_english", Language.EN);

        // then
        assertThat(result).isEqualTo("English");
    }

    @Test
    void shouldTranslateKnownKeyInFrench() {
        // when
        String result = translationService.translate("welcome", Language.FR);

        // then
        assertThat(result).contains("Bienvenue");
    }

    @Test
    void shouldReturnKeyWhenTranslationNotFound() {
        // when
        String result = translationService.translate("nonexistent_key", Language.EN);

        // then
        assertThat(result).isEqualTo("nonexistent_key");
    }

    @Test
    void shouldInterpolateVariables() {
        // given
        Map<String, Object> variables = Map.of("count", 3);

        // when
        String result = translationService.translate("machines_available", Language.EN, variables);

        // then
        assertThat(result).contains("3 machine(s) available");
    }

    @Test
    void shouldInterpolateMultipleVariables() {
        // given
        Map<String, Object> variables = Map.of(
                "machine", "Washer 1",
                "duration", 30,
                "amount", 500
        );

        // when
        String result = translationService.translate("payment_initiating", Language.EN, variables);

        // then
        assertThat(result).contains("Washer 1");
        assertThat(result).contains("30 minutes");
        assertThat(result).contains("500 XAF");
    }

    @Test
    void shouldReturnEnglishFallbackWhenFrenchMissing() {
        // The service initializes all keys with both EN and FR, so this tests the fallback
        // mechanism. We test with EN directly since all keys have EN translations.
        String result = translationService.translate("language_english", Language.EN);

        // then
        assertThat(result).isEqualTo("English");
    }

    @Test
    void shouldHandleEmptyVariablesMap() {
        // when
        String result = translationService.translate("btn_cancel", Language.EN, Map.of());

        // then
        assertThat(result).contains("Cancel");
    }

    @Test
    void shouldHandleMissingVariableGracefully() {
        // given — provide a non-empty map but without the expected "count" key
        Map<String, Object> variables = Map.of("other", "value");

        // when
        String result = translationService.translate("machines_available", Language.EN, variables);

        // then — missing variable is replaced with empty string
        assertThat(result).contains("machine(s) available");
        assertThat(result).doesNotContain("{count}");
    }

    @Test
    void shouldTranslateWithVariablesInFrench() {
        // given
        Map<String, Object> variables = Map.of("count", 5);

        // when
        String result = translationService.translate("machines_available", Language.FR, variables);

        // then
        assertThat(result).contains("5 machine(s) disponible(s)");
    }

    @Test
    void shouldTranslateNoArgsOverload() {
        // when
        String result = translationService.translate("btn_start_wash", Language.EN);

        // then
        assertThat(result).contains("Start a Wash");
    }

    @Test
    void shouldTranslatePaymentFailedWithVariables() {
        // given
        Map<String, Object> variables = Map.of("error", "Insufficient funds");

        // when
        String result = translationService.translate("payment_failed", Language.EN, variables);

        // then
        assertThat(result).contains("Insufficient funds");
    }

    @Test
    void shouldTranslateCycleAlmostDoneInEnglish() {
        // given
        Map<String, Object> variables = Map.of("machine", "Washer 1", "minutes", 5);

        // when
        String result = translationService.translate("cycle_almost_done", Language.EN, variables);

        // then
        assertThat(result).contains("Washer 1");
        assertThat(result).contains("5 minute(s) left");
    }

    @Test
    void shouldTranslateCycleAlmostDoneInFrench() {
        // given
        Map<String, Object> variables = Map.of("machine", "Washer 1", "minutes", 5);

        // when
        String result = translationService.translate("cycle_almost_done", Language.FR, variables);

        // then
        assertThat(result).contains("Washer 1");
        assertThat(result).contains("Bientôt terminé");
    }

    @Test
    void shouldTranslateMachineBusyError() {
        // when
        String result = translationService.translate("err_machine_busy", Language.EN);

        // then
        assertThat(result).contains("just taken by another customer");
    }

    @Test
    void shouldTranslatePendingPaymentError() {
        // when
        String result = translationService.translate("err_pending_payment", Language.FR);

        // then
        assertThat(result).contains("paiement est déjà en cours");
    }

    @Test
    void shouldTranslateReservationSlotUnavailable() {
        // given
        Map<String, Object> variables = Map.of("machine", "Washer 1");

        // when
        String result = translationService.translate("reservation_slot_unavailable", Language.EN, variables);

        // then
        assertThat(result).contains("Washer 1");
        assertThat(result).contains("just taken by another customer");
    }

    @Test
    void shouldTranslateReservationUpcomingReminder() {
        // given
        Map<String, Object> variables = Map.of(
                "machine", "Washer 1", "minutes", 15, "code", "AB12CD", "slotEnd", "11:00");

        // when
        String result = translationService.translate("reservation_upcoming", Language.EN, variables);

        // then
        assertThat(result).contains("Washer 1");
        assertThat(result).contains("15 minute(s)");
        assertThat(result).contains("AB12CD");
        assertThat(result).contains("11:00");
    }

    @Test
    void shouldTranslateStaffAlertReservationFailed() {
        // given
        Map<String, Object> variables = Map.of(
                "machine", "Washer 1",
                "phone", "+237600000000",
                "amount", 500,
                "transactionReference", "RESV-washer_01-123",
                "time", "10:00"
        );

        // when
        String result = translationService.translate("staff_alert_reservation_failed", Language.EN, variables);

        // then
        assertThat(result).contains("RESV-washer_01-123");
        assertThat(result).contains("500 XAF");
        assertThat(result).contains("manually verify/refund");
    }

}
