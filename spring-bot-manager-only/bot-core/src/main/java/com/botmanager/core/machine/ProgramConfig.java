package com.botmanager.core.machine;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class ProgramConfig {

    private String id;

    private String label;

    private int amount;

    private String currency;

    private int durationSeconds;

}
