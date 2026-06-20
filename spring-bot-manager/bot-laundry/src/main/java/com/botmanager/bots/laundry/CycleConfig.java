package com.botmanager.bots.laundry;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class CycleConfig {

    private int duration;

    private int price;

    private int pulseCount;

    private String currency = "XAF";

    public CycleConfig() {
    }

    public CycleConfig(int duration, int price, int pulseCount) {
        this.duration = duration;
        this.price = price;
        this.pulseCount = pulseCount;
    }

}
