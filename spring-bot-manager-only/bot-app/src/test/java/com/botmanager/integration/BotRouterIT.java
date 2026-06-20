package com.botmanager.integration;

import com.botmanager.core.bot.BotLookup;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
class BotRouterIT extends BaseIntegrationTest {

    @Autowired
    private BotLookup botLookup;

    @Test
    void routesByPhoneNumberId() {
        // Both bots should be auto-registered via their @Configuration classes
        var laundry = botLookup.getBotByName("laundry");
        assertThat(laundry).isPresent();
        assertThat(laundry.get().getConfig().getBotId()).isEqualTo("laundry");

        var thomasNetwork = botLookup.getBotByName("thomasnetwork");
        assertThat(thomasNetwork).isPresent();
        assertThat(thomasNetwork.get().getConfig().getBotId()).isEqualTo("thomasnetwork");
    }

    @Test
    void differentBotsHaveDifferentPhoneIds() {
        var laundry = botLookup.getBotByName("laundry");
        var thomasNetwork = botLookup.getBotByName("thomasnetwork");

        assertThat(laundry).isPresent();
        assertThat(thomasNetwork).isPresent();

        assertThat(laundry.get().getConfig().getPhoneNumberId())
                .isNotEqualTo(thomasNetwork.get().getConfig().getPhoneNumberId());
    }

    @Test
    void lookupByPhoneIdMatchesBotName() {
        var laundry = botLookup.getBotByName("laundry");
        assertThat(laundry).isPresent();

        String phoneId = laundry.get().getConfig().getPhoneNumberId();
        var found = botLookup.getBotByPhoneId(phoneId);
        assertThat(found).isPresent();
        assertThat(found.get().getConfig().getBotId()).isEqualTo("laundry");
    }

}
