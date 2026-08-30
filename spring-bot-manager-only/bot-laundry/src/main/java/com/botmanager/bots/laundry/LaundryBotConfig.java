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

    private List<MachineConfig> machines;

    private Map<String, List<ProgramConfig>> programs;

    private CycleConfig shortCycle = new CycleConfig(30, 1000, 1);

    private CycleConfig longCycle = new CycleConfig(60, 2000, 2);

    private BusinessHoursConfig businessHours = new BusinessHoursConfig();

    private List<String> availableMachineIds;

    private String staffAlertPhone;

    private FeaturesConfig features = new FeaturesConfig();

    private ReservationConfig reservation = new ReservationConfig();

    /**
     * Feature flags for the laundry bot. Both default to DISABLED.
     *
     * <ul>
     *   <li>{@code washFlowEnabled} — gates the machine-select → cycle-select → payment
     *       flow. When false, users may only check availability/info and cannot start a
     *       wash cycle from the bot.</li>
     *   <li>{@code reservationEnabled} — gates the reservation entry point (reserve a
     *       1-hour slot, pay the reservation fee, receive a code on WhatsApp).</li>
     * </ul>
     */
    @Getter
    @Setter
    public static class ReservationConfig {

        private int price = 500;

        private int durationMinutes = 60;
    }

    @Getter
    @Setter
    public static class FeaturesConfig {

        private boolean washFlowEnabled = false;

        private boolean reservationEnabled = false;
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
