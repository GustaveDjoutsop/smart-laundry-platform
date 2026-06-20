package com.botmanager.bots.laundry;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class LaundryStepTest {

    @Test
    void shouldHaveLanguageSelectionConstant() {
        assertThat(LaundryStep.LANGUAGE_SELECTION).isEqualTo("LANGUAGE_SELECTION");
    }

    @Test
    void shouldHaveAwaitingLanguageChoiceConstant() {
        assertThat(LaundryStep.AWAITING_LANGUAGE_CHOICE).isEqualTo("AWAITING_LANGUAGE_CHOICE");
    }

    @Test
    void shouldHaveMainMenuConstant() {
        assertThat(LaundryStep.MAIN_MENU).isEqualTo("MAIN_MENU");
    }

    @Test
    void shouldHaveAwaitingMenuChoiceConstant() {
        assertThat(LaundryStep.AWAITING_MENU_CHOICE).isEqualTo("AWAITING_MENU_CHOICE");
    }

    @Test
    void shouldHaveSelectMachineMethodConstant() {
        assertThat(LaundryStep.SELECT_MACHINE_METHOD).isEqualTo("SELECT_MACHINE_METHOD");
    }

    @Test
    void shouldHaveAwaitingManualMachineIdConstant() {
        assertThat(LaundryStep.AWAITING_MANUAL_MACHINE_ID).isEqualTo("AWAITING_MANUAL_MACHINE_ID");
    }

    @Test
    void shouldHaveAwaitingMachineSelectionConstant() {
        assertThat(LaundryStep.AWAITING_MACHINE_SELECTION).isEqualTo("AWAITING_MACHINE_SELECTION");
    }

    @Test
    void shouldHaveSelectCycleConstant() {
        assertThat(LaundryStep.SELECT_CYCLE).isEqualTo("SELECT_CYCLE");
    }

    @Test
    void shouldHaveAwaitingDateSelectionConstant() {
        assertThat(LaundryStep.AWAITING_DATE_SELECTION).isEqualTo("AWAITING_DATE_SELECTION");
    }

    @Test
    void shouldHaveAwaitingTimeSelectionConstant() {
        assertThat(LaundryStep.AWAITING_TIME_SELECTION).isEqualTo("AWAITING_TIME_SELECTION");
    }

    @Test
    void shouldHaveAwaitingReservationConfirmConstant() {
        assertThat(LaundryStep.AWAITING_RESERVATION_CONFIRM).isEqualTo("AWAITING_RESERVATION_CONFIRM");
    }

    @Test
    void shouldHaveAwaitingFeedbackConstant() {
        assertThat(LaundryStep.AWAITING_FEEDBACK).isEqualTo("AWAITING_FEEDBACK");
    }

    @Test
    void shouldHaveAwaitingFeedbackCommentConstant() {
        assertThat(LaundryStep.AWAITING_FEEDBACK_COMMENT).isEqualTo("AWAITING_FEEDBACK_COMMENT");
    }
}
