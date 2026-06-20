package com.botmanager.bots.laundry;

import com.botmanager.core.flow.ConversationState;
import com.botmanager.core.i18n.Language;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class LaundryConversationState extends ConversationState {

    private Language language;

    private String step = "LANGUAGE_SELECTION";

    private String machineId;

    private String feedbackTransactionId;

    public LaundryConversationState() {
        super();
    }

    public void resetToMainMenu() {
        this.step = "MAIN_MENU";
        this.machineId = null;
        this.feedbackTransactionId = null;
    }

    public void resetToLanguageSelection() {
        this.step = "LANGUAGE_SELECTION";
        this.machineId = null;
        this.feedbackTransactionId = null;
    }

    public boolean hasLanguage() {
        return language != null;
    }

}
