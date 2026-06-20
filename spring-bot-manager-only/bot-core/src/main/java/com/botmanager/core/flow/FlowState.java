package com.botmanager.core.flow;

import lombok.Getter;
import lombok.Setter;

import java.util.List;
import java.util.Map;

@Getter
@Setter
public class FlowState {

    private String id;

    private StateType type;

    private String template;

    private String next;

    private String saveAs;

    private String prompt;

    private String action;

    private Map<String, Object> params;

    private List<ButtonOption> buttons;

    private String buttonsFromContext;

    @Getter
    @Setter
    public static class ButtonOption {

        private String id;

        private String title;
    }

}
