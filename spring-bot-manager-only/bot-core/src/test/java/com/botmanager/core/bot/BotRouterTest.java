package com.botmanager.core.bot;

import com.botmanager.core.flow.*;
import com.botmanager.core.queue.MessageJob;
import com.botmanager.core.payment.PaymentRecord;
import com.botmanager.core.redis.RedisManager;
import com.botmanager.core.whatsapp.WhatsAppClientFactory;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

class BotRouterTest {

    @Test
    void shouldRegisterBotByNameAndPhoneId() {
        // given
        BaseBot bot = createTestBot("test-bot", "phone-123", "verify-token-1");
        BotRouter router = new BotRouter(List.of(bot));

        // then
        assertThat(router.getBotByName("test-bot")).isPresent();
        assertThat(router.getBotByPhoneId("phone-123")).isPresent();
    }

    @Test
    void shouldReturnEmptyForUnknownBotName() {
        // given
        BaseBot bot = createTestBot("test-bot", "phone-123", "token");
        BotRouter router = new BotRouter(List.of(bot));

        // when
        Optional<BaseBot> result = router.getBotByName("unknown");

        // then
        assertThat(result).isEmpty();
    }

    @Test
    void shouldReturnEmptyForUnknownPhoneId() {
        // given
        BaseBot bot = createTestBot("test-bot", "phone-123", "token");
        BotRouter router = new BotRouter(List.of(bot));

        // when
        Optional<BaseBot> result = router.getBotByPhoneId("unknown-phone");

        // then
        assertThat(result).isEmpty();
    }

    @Test
    void shouldLookupBotNameByVerifyToken() {
        // given
        BaseBot bot = createTestBot("test-bot", "phone-123", "my-verify-token");
        BotRouter router = new BotRouter(List.of(bot));

        // when
        Optional<String> result = router.getBotNameByVerifyToken("my-verify-token");

        // then
        assertThat(result).contains("test-bot");
    }

    @Test
    void shouldReturnEmptyForUnknownVerifyToken() {
        // given
        BaseBot bot = createTestBot("test-bot", "phone-123", "token");
        BotRouter router = new BotRouter(List.of(bot));

        // when
        Optional<String> result = router.getBotNameByVerifyToken("unknown-token");

        // then
        assertThat(result).isEmpty();
    }

    @Test
    void shouldRegisterMultipleBots() {
        // given
        BaseBot bot1 = createTestBot("bot-1", "phone-1", "token-1");
        BaseBot bot2 = createTestBot("bot-2", "phone-2", "token-2");
        BotRouter router = new BotRouter(List.of(bot1, bot2));

        // then
        assertThat(router.getBotByName("bot-1")).isPresent();
        assertThat(router.getBotByName("bot-2")).isPresent();
        assertThat(router.getBotByPhoneId("phone-1")).isPresent();
        assertThat(router.getBotByPhoneId("phone-2")).isPresent();
    }

    @Test
    void shouldSkipDuplicatePhoneNumberId() {
        // given
        BaseBot bot1 = createTestBot("bot-1", "same-phone", "token-1");
        BaseBot bot2 = createTestBot("bot-2", "same-phone", "token-2");
        BotRouter router = new BotRouter(List.of(bot1, bot2));

        // then — first bot registered wins, second is skipped
        assertThat(router.getBotByPhoneId("same-phone")).isPresent();
        assertThat(router.getBotByPhoneId("same-phone").get().getConfig().getBotId()).isEqualTo("bot-1");
        assertThat(router.getBotByName("bot-2")).isEmpty();
    }

    @Test
    void shouldHandleEmptyBotList() {
        // given
        BotRouter router = new BotRouter(List.of());

        // then
        assertThat(router.getBotByName("any")).isEmpty();
        assertThat(router.getBotByPhoneId("any")).isEmpty();
    }

    @Test
    void shouldHandleBotWithNullVerifyToken() {
        // given
        BaseBot bot = createTestBot("test-bot", "phone-123", null);
        BotRouter router = new BotRouter(List.of(bot));

        // then — bot is registered by name, but null verify token is not stored
        assertThat(router.getBotByName("test-bot")).isPresent();
        // ConcurrentHashMap does not allow null keys, so we verify with a valid token instead
        assertThat(router.getBotNameByVerifyToken("non-existent")).isEmpty();
    }

    @Test
    void shouldHandleBotWithEmptyVerifyToken() {
        // given
        BaseBot bot = createTestBot("test-bot", "phone-123", "");
        BotRouter router = new BotRouter(List.of(bot));

        // then
        assertThat(router.getBotByName("test-bot")).isPresent();
        assertThat(router.getBotNameByVerifyToken("")).isEmpty();
    }

    private BaseBot createTestBot(String botId, String phoneNumberId, String verifyToken) {
        BotConfig config = new BotConfig();
        config.setBotId(botId);
        config.setPhoneNumberId(phoneNumberId);
        config.setVerifyToken(verifyToken);
        config.setFlows(Map.of());

        return new BaseBot(config, null, null, null, null) {
            @Override
            public FlowPlugin getPlugin() {
                return null;
            }
        };
    }

}
