package com.botmanager.notification;

import com.botmanager.config.RateLimitProperties;
import com.botmanager.core.bot.BaseBot;
import com.botmanager.core.bot.BotLookup;
import com.botmanager.core.bot.ProactiveNotifier;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Map;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(NotificationController.class)
@Import(NotificationControllerTest.TestSecurityConfig.class)
class NotificationControllerTest {

    @TestConfiguration
    static class TestSecurityConfig {
        @Bean
        SecurityFilterChain testFilterChain(HttpSecurity http) throws Exception {
            http.csrf(AbstractHttpConfigurer::disable)
                .authorizeHttpRequests(auth -> auth.anyRequest().permitAll());
            return http.build();
        }

        @Bean
        RateLimitProperties rateLimitProperties() {
            return new RateLimitProperties();
        }
    }

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper objectMapper;

    @MockitoBean
    BotLookup botLookup;

    @Test
    void shouldSendNotificationThroughProactiveNotifierBot() throws Exception {
        // given
        BaseBot bot = mock(BaseBot.class, org.mockito.Mockito.withSettings().extraInterfaces(ProactiveNotifier.class));
        when(botLookup.getBotByName("laundry")).thenReturn(Optional.of(bot));

        String body = """
                {"botId":"laundry","phone":"+237690000000","messageKey":"status_none","params":{}}
                """;

        // when / then
        mockMvc.perform(post("/api/notifications/send")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("sent"));

        verify((ProactiveNotifier) bot).sendProactiveNotification(
                eq("+237690000000"), eq("status_none"), eq(Map.of()));
    }

    @Test
    void shouldReturn404WhenBotUnknown() throws Exception {
        // given
        when(botLookup.getBotByName("unknown")).thenReturn(Optional.empty());

        String body = """
                {"botId":"unknown","phone":"+237690000000","messageKey":"status_none"}
                """;

        // when / then
        mockMvc.perform(post("/api/notifications/send")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("Not Found"));
    }

    @Test
    void shouldReturn501WhenBotDoesNotSupportProactiveNotifications() throws Exception {
        // given — a bot that does NOT implement ProactiveNotifier
        BaseBot plainBot = mock(BaseBot.class);
        when(botLookup.getBotByName("thomasnetwork")).thenReturn(Optional.of(plainBot));

        String body = """
                {"botId":"thomasnetwork","phone":"+237690000000","messageKey":"status_none"}
                """;

        // when / then
        mockMvc.perform(post("/api/notifications/send")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isNotImplemented())
                .andExpect(jsonPath("$.error").value("Not Implemented"));
    }

    @Test
    void shouldReturn400WhenMessageKeyMissing() throws Exception {
        // given
        String body = """
                {"botId":"laundry","phone":"+237690000000"}
                """;

        // when / then
        mockMvc.perform(post("/api/notifications/send")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("Bad Request"));
    }
}
