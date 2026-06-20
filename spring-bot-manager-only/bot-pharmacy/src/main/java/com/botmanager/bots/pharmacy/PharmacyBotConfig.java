package com.botmanager.bots.pharmacy;

import com.botmanager.core.bot.BotConfig;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class PharmacyBotConfig extends BotConfig {

    private String pharmacyName;

    private String currency = "XAF";

    private String staffAlertPhone;

    private BusinessHoursConfig businessHours = new BusinessHoursConfig();

    @Getter
    @Setter
    public static class BusinessHoursConfig {

        private String openTime = "08:00";

        private String closeTime = "20:00";

        private String timezone = "Africa/Douala";
    }

}
