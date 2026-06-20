package com.botmanager.core;

import com.botmanager.core.bot.BaseBot;
import com.botmanager.core.bot.BotConfig;
import com.botmanager.core.bot.BotLookup;
import com.botmanager.core.persistence.MessageLogger;
import com.botmanager.core.queue.MessageJob;
import com.botmanager.core.redis.RedisManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Map;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class MessageProcessorTest {

    @Mock
    private BotLookup botLookup;

    @Mock
    private RedisManager redisManager;

    @Mock
    private MessageLogger messageLogger;

    @Mock
    private BaseBot bot;

    private MessageProcessor messageProcessor;

    @BeforeEach
    void setUp() {
        messageProcessor = new MessageProcessor(botLookup, redisManager, messageLogger);
    }

    @Test
    void shouldProcessMessageWhenBotFoundAndLockAcquired() {
        // given
        MessageJob job = MessageJob.builder()
                .phoneNumberId("phone-123")
                .from("+237690000000")
                .messageId("msg-1")
                .messageBody("hello")
                .messageType("text")
                .build();

        BotConfig config = new BotConfig();
        config.setBotId("test-bot");

        when(botLookup.getBotByPhoneId("phone-123")).thenReturn(Optional.of(bot));
        when(bot.getConfig()).thenReturn(config);
        when(redisManager.setIfAbsent(anyString(), eq("1"), eq(60L))).thenReturn(true);

        // when
        messageProcessor.processMessage(job);

        // then
        verify(messageLogger).logInbound("test-bot", "+237690000000", "text", "hello", "msg-1");
        verify(bot).handleMessage(job);
    }

    @Test
    void shouldSkipDuplicateMessage() {
        // given
        MessageJob job = MessageJob.builder()
                .phoneNumberId("phone-123")
                .from("+237690000000")
                .messageId("msg-1")
                .messageBody("hello")
                .messageType("text")
                .build();

        BotConfig config = new BotConfig();
        config.setBotId("test-bot");

        when(botLookup.getBotByPhoneId("phone-123")).thenReturn(Optional.of(bot));
        when(bot.getConfig()).thenReturn(config);
        when(redisManager.setIfAbsent(anyString(), eq("1"), eq(60L))).thenReturn(false);

        // when
        messageProcessor.processMessage(job);

        // then
        verify(bot, never()).handleMessage(any());
        verify(messageLogger, never()).logInbound(anyString(), anyString(), anyString(), anyString(), anyString());
    }

    @Test
    void shouldDoNothingWhenBotNotFound() {
        // given
        MessageJob job = MessageJob.builder()
                .phoneNumberId("unknown-phone")
                .from("+237690000000")
                .messageId("msg-1")
                .messageBody("hello")
                .messageType("text")
                .build();

        when(botLookup.getBotByPhoneId("unknown-phone")).thenReturn(Optional.empty());

        // when
        messageProcessor.processMessage(job);

        // then
        verify(redisManager, never()).setIfAbsent(anyString(), anyString(), anyLong());
        verify(messageLogger, never()).logInbound(anyString(), anyString(), anyString(), anyString(), anyString());
    }

    @Test
    void shouldHandleExceptionFromBotGracefully() {
        // given
        MessageJob job = MessageJob.builder()
                .phoneNumberId("phone-123")
                .from("+237690000000")
                .messageId("msg-1")
                .messageBody("hello")
                .messageType("text")
                .build();

        BotConfig config = new BotConfig();
        config.setBotId("test-bot");

        when(botLookup.getBotByPhoneId("phone-123")).thenReturn(Optional.of(bot));
        when(bot.getConfig()).thenReturn(config);
        when(redisManager.setIfAbsent(anyString(), eq("1"), eq(60L))).thenReturn(true);
        doThrow(new RuntimeException("Bot failure")).when(bot).handleMessage(any());

        // when — should not propagate the exception
        messageProcessor.processMessage(job);

        // then
        verify(messageLogger).logInbound("test-bot", "+237690000000", "text", "hello", "msg-1");
    }

}
