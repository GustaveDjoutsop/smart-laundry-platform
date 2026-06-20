package com.botmanager.core.bot;

import com.botmanager.core.flow.FlowDefinition;
import lombok.Getter;
import lombok.Setter;

import java.util.Map;

@Getter
@Setter
public class BotConfig {

    private String botId;

    private String botName;

    private String botType;

    private String phoneNumberId;

    private String verifyToken;

    private String defaultFlowId;

    private Map<String, FlowDefinition> flows;

}
