package com.botmanager.core.whatsapp;

import com.botmanager.config.WhatsAppProperties;
import com.botmanager.core.flow.MessageSender;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class WhatsAppClientTest {

    @Mock
    RestTemplate restTemplate;

    private WhatsAppClient client() {
        return new WhatsAppClient("123", "token", new WhatsAppProperties(), restTemplate);
    }

    @Test
    @SuppressWarnings("unchecked")
    void sendListShouldNotThrowWhenSectionTitleIsNull() {
        // given: a list message with a null section title, as sent by the main menu
        // (a null value here previously reached Map.of(...), which throws NPE on any null value)
        MessageSender.ListRow row = new MessageSender.ListRow("action_wash", "Start a Wash", null);
        MessageSender.ListSection section = new MessageSender.ListSection(null, List.of(row));
        MessageSender.ListMessage message = new MessageSender.ListMessage("Welcome!", "Menu", List.of(section));

        when(restTemplate.exchange(any(String.class), eq(HttpMethod.POST), any(HttpEntity.class), eq(Map.class)))
                .thenReturn(ResponseEntity.ok(Map.of()));

        // when / then: must not throw
        client().sendList("491700000000", message);

        // and: the outgoing payload's section must omit "title" rather than send null
        ArgumentCaptor<HttpEntity<Map<String, Object>>> captor = ArgumentCaptor.forClass(HttpEntity.class);
        org.mockito.Mockito.verify(restTemplate).exchange(any(String.class), eq(HttpMethod.POST), captor.capture(), eq(Map.class));

        Map<String, Object> payload = captor.getValue().getBody();
        Map<String, Object> interactive = (Map<String, Object>) payload.get("interactive");
        Map<String, Object> action = (Map<String, Object>) interactive.get("action");
        List<Map<String, Object>> sections = (List<Map<String, Object>>) action.get("sections");

        assertThat(sections).hasSize(1);
        assertThat(sections.get(0)).doesNotContainKey("title");
        assertThat(sections.get(0)).containsKey("rows");
    }

    @Test
    @SuppressWarnings("unchecked")
    void sendListShouldIncludeSectionTitleWhenPresent() {
        MessageSender.ListRow row = new MessageSender.ListRow("action_wash", "Start a Wash", null);
        MessageSender.ListSection section = new MessageSender.ListSection("Main Menu", List.of(row));
        MessageSender.ListMessage message = new MessageSender.ListMessage("Welcome!", "Menu", List.of(section));

        when(restTemplate.exchange(any(String.class), eq(HttpMethod.POST), any(HttpEntity.class), eq(Map.class)))
                .thenReturn(ResponseEntity.ok(Map.of()));

        client().sendList("491700000000", message);

        ArgumentCaptor<HttpEntity<Map<String, Object>>> captor = ArgumentCaptor.forClass(HttpEntity.class);
        org.mockito.Mockito.verify(restTemplate).exchange(any(String.class), eq(HttpMethod.POST), captor.capture(), eq(Map.class));

        Map<String, Object> payload = captor.getValue().getBody();
        Map<String, Object> interactive = (Map<String, Object>) payload.get("interactive");
        Map<String, Object> action = (Map<String, Object>) interactive.get("action");
        List<Map<String, Object>> sections = (List<Map<String, Object>>) action.get("sections");

        assertThat(sections.get(0)).containsEntry("title", "Main Menu");
    }
}
