package com.botmanager.bots.laundry;

import com.botmanager.core.i18n.Language;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class LaundryConversationStateTest {

    @Test
    void shouldInitializeWithDefaults() {
        // given / when
        LaundryConversationState state = new LaundryConversationState();

        // then
        assertThat(state.getStep()).isEqualTo("LANGUAGE_SELECTION");
        assertThat(state.getLanguage()).isNull();
        assertThat(state.getMachineId()).isNull();
        assertThat(state.getFeedbackTransactionId()).isNull();
    }

    @Test
    void shouldResetToMainMenu() {
        // given
        LaundryConversationState state = new LaundryConversationState();
        state.setStep("SELECT_CYCLE");
        state.setMachineId("w1");
        state.setFeedbackTransactionId("txn-1");

        // when
        state.resetToMainMenu();

        // then
        assertThat(state.getStep()).isEqualTo("MAIN_MENU");
        assertThat(state.getMachineId()).isNull();
        assertThat(state.getFeedbackTransactionId()).isNull();
    }

    @Test
    void shouldResetToLanguageSelection() {
        // given
        LaundryConversationState state = new LaundryConversationState();
        state.setStep("MAIN_MENU");
        state.setMachineId("w1");
        state.setFeedbackTransactionId("txn-1");

        // when
        state.resetToLanguageSelection();

        // then
        assertThat(state.getStep()).isEqualTo("LANGUAGE_SELECTION");
        assertThat(state.getMachineId()).isNull();
        assertThat(state.getFeedbackTransactionId()).isNull();
    }

    @Test
    void shouldReturnTrueWhenHasLanguage() {
        // given
        LaundryConversationState state = new LaundryConversationState();
        state.setLanguage(Language.EN);

        // when / then
        assertThat(state.hasLanguage()).isTrue();
    }

    @Test
    void shouldReturnFalseWhenNoLanguage() {
        // given
        LaundryConversationState state = new LaundryConversationState();

        // when / then
        assertThat(state.hasLanguage()).isFalse();
    }
}
