package com.botmanager.core.flow;

import lombok.Getter;
import lombok.Setter;

import java.util.List;
import java.util.Map;

@Getter
@Setter
public class FlowDefinition {

    private String id;

    private List<String> triggers;

    private Map<String, FlowState> states;

    private String startState;

}
