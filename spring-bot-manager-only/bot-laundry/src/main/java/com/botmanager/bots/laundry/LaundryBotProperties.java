package com.botmanager.bots.laundry;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "smartbot.bots.laundry")
@Getter
@Setter
public class LaundryBotProperties {

    private FeaturesOverride features = new FeaturesOverride();

    @Getter
    @Setter
    public static class FeaturesOverride {

        /**
         * When set, overrides the {@code features.washFlowEnabled} value from the DB/JSON config.
         * Leave unset (null) to use the persisted value.
         */
        private Boolean washFlowEnabled;

        /**
         * When set, overrides the {@code features.reservationEnabled} value from the DB/JSON config.
         * Leave unset (null) to use the persisted value.
         */
        private Boolean reservationEnabled;
    }
}
