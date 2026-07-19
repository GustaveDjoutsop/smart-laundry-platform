package com.smartlaundromat.payment.service.notification;

import com.smartlaundromat.payment.model.Transaction;
import com.smartlaundromat.payment.model.enums.PaymentProvider;
import com.smartlaundromat.payment.model.enums.PaymentStatus;
import io.github.resilience4j.bulkhead.BulkheadRegistry;
import io.github.resilience4j.circuitbreaker.CircuitBreakerRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpEntity;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestTemplate;

import java.math.BigDecimal;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class BotNotificationClientTest {

    @Mock
    RestTemplate restTemplate;

    BotNotificationClient botNotificationClient;

    private Transaction transaction;

    @BeforeEach
    void setUp() {
        botNotificationClient = new BotNotificationClient(
                restTemplate,
                CircuitBreakerRegistry.ofDefaults(),
                BulkheadRegistry.ofDefaults(),
                "http://localhost:8090",
                "laundry");

        transaction = Transaction.builder()
                .externalReference("EXT-001")
                .machineId("MACH-01")
                .phoneNumber("+237600000000")
                .amount(new BigDecimal("1000"))
                .cycleDuration(30)
                .paymentProvider(PaymentProvider.CAMPAY)
                .status(PaymentStatus.SUCCESSFUL)
                .build();
    }

    @SuppressWarnings("unchecked")
    @Test
    void shouldPostCycleAlmostDoneWithExpectedBody() {
        when(restTemplate.postForEntity(anyString(), any(HttpEntity.class), eq(Map.class)))
                .thenReturn(ResponseEntity.ok(Map.of("status", "sent")));

        botNotificationClient.sendCycleAlmostDone(transaction, 5);

        ArgumentCaptor<HttpEntity<Map<String, Object>>> captor = ArgumentCaptor.forClass(HttpEntity.class);
        verify(restTemplate).postForEntity(
                eq("http://localhost:8090/api/notifications/send"),
                captor.capture(),
                eq(Map.class));

        Map<String, Object> body = captor.getValue().getBody();
        assertThat(body).isNotNull();
        assertThat(body.get("botId")).isEqualTo("laundry");
        assertThat(body.get("phone")).isEqualTo("+237600000000");
        assertThat(body.get("messageKey")).isEqualTo("cycle_almost_done");

        Map<String, Object> params = (Map<String, Object>) body.get("params");
        assertThat(params.get("machine")).isEqualTo("MACH-01");
        assertThat(params.get("minutes")).isEqualTo(5);
    }

    @Test
    void shouldPropagateExceptionOnRestTemplateFailure() {
        when(restTemplate.postForEntity(anyString(), any(HttpEntity.class), eq(Map.class)))
                .thenThrow(new RuntimeException("Connection refused"));

        assertThatThrownBy(() -> botNotificationClient.sendCycleAlmostDone(transaction, 5))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("Connection refused");
    }

    @SuppressWarnings("unchecked")
    @Test
    void shouldPostCycleCompletedWithExpectedBody() {
        when(restTemplate.postForEntity(anyString(), any(HttpEntity.class), eq(Map.class)))
                .thenReturn(ResponseEntity.ok(Map.of("status", "sent")));

        botNotificationClient.sendCycleCompleted(transaction, "14:30");

        ArgumentCaptor<HttpEntity<Map<String, Object>>> captor = ArgumentCaptor.forClass(HttpEntity.class);
        verify(restTemplate).postForEntity(
                eq("http://localhost:8090/api/notifications/send"),
                captor.capture(),
                eq(Map.class));

        Map<String, Object> body = captor.getValue().getBody();
        assertThat(body).isNotNull();
        assertThat(body.get("botId")).isEqualTo("laundry");
        assertThat(body.get("phone")).isEqualTo("+237600000000");
        assertThat(body.get("messageKey")).isEqualTo("cycle_completed");

        Map<String, Object> params = (Map<String, Object>) body.get("params");
        assertThat(params.get("machine")).isEqualTo("MACH-01");
        assertThat(params.get("endTime")).isEqualTo("14:30");
        assertThat(params.get("transactionId")).isEqualTo("EXT-001");
    }

    @Test
    void shouldPropagateExceptionOnCycleCompletedRestTemplateFailure() {
        when(restTemplate.postForEntity(anyString(), any(HttpEntity.class), eq(Map.class)))
                .thenThrow(new RuntimeException("Connection refused"));

        assertThatThrownBy(() -> botNotificationClient.sendCycleCompleted(transaction, "14:30"))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("Connection refused");
    }
}
