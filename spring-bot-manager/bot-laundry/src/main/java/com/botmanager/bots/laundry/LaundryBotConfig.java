package com.botmanager.bots.laundry;

import com.botmanager.core.bot.BotConfig;
import com.botmanager.core.machine.MachineConfig;
import com.botmanager.core.machine.ProgramConfig;
import lombok.Getter;
import lombok.Setter;

import java.util.List;
import java.util.Map;

@Getter
@Setter
public class LaundryBotConfig extends BotConfig {

    private MqttConfig mqtt;

    private List<MachineConfig> machines;

    private Map<String, List<ProgramConfig>> programs;

    private CycleConfig shortCycle = new CycleConfig(30, 1000, 1);

    private CycleConfig longCycle = new CycleConfig(60, 2000, 2);

    private BusinessHoursConfig businessHours = new BusinessHoursConfig();

    private List<String> availableMachineIds;

    private String staffAlertPhone;

    @Getter
    @Setter
    public static class MqttConfig {

        private String topicPrefix;
    }

    @Getter
    @Setter
    public static class BusinessHoursConfig {

        private String openTime = "07:00";

        private String closeTime = "22:00";

        private int closingBufferMinutes = 15;

        private String timezone = "Africa/Douala";
    }

}
