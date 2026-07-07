package com.botmanager.bots.laundry;

import com.botmanager.core.flow.FlowEngine;
import com.botmanager.core.i18n.Language;
import com.botmanager.core.i18n.TranslationService;
import com.botmanager.core.machine.MachineService;
import com.botmanager.core.payment.PaymentGateway;
import com.botmanager.core.payment.PaymentRecord;
import com.botmanager.core.payment.PaymentStatus;
import com.botmanager.core.redis.RedisManager;
import com.botmanager.core.whatsapp.WhatsAppClient;
import com.botmanager.core.whatsapp.WhatsAppClientFactory;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import com.botmanager.bots.laundry.PricingClient;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class LaundryBotTest {

    @Mock
    FlowEngine flowEngine;

    @Mock
    RedisManager redisManager;

    @Mock
    WhatsAppClientFactory whatsAppClientFactory;

    @Mock
    PaymentGateway paymentGateway;

    @Mock
    MachineService machineService;

    @Mock
    WhatsAppClient whatsAppClient;

    @Mock
    PricingClient pricingClient;

    @Mock
    TransactionClient transactionClient;

    TranslationService translationService;

    ObjectMapper objectMapper;

    LaundryBot laundryBot;

    LaundryBotConfig config;

    @BeforeEach
    void setUp() {
        translationService = new TranslationService();
        objectMapper = new ObjectMapper();
        config = new LaundryBotConfig();
        config.setBotId("test-laundry");
        config.setPhoneNumberId("phone-123");

        lenient().when(whatsAppClientFactory.getClient("test-laundry", "phone-123"))
                .thenReturn(whatsAppClient);

        laundryBot = new LaundryBot(config, flowEngine, redisManager,
                whatsAppClientFactory, objectMapper, paymentGateway,
                machineService, translationService, pricingClient, transactionClient);
    }

    @Test
    void shouldReturnPlugin() {
        // given / when / then
        assertThat(laundryBot.getPlugin()).isNotNull();
    }

    @Nested
    class OnPaymentCompleted {

        @Test
        void shouldSendWashConfirmationMessage() {
            // given
            Map<String, Object> metadata = new HashMap<>();
            metadata.put("machineName", "Washer 1");
            metadata.put("duration", 30);
            metadata.put("language", "EN");

            PaymentRecord record = PaymentRecord.builder()
                    .transactionId("txn-1")
                    .customerPhone("+237690000000")
                    .amount(1000)
                    .botId("test-laundry")
                    .metadata(metadata)
                    .build();

            // when
            laundryBot.onPaymentCompleted(record);

            // then
            verify(whatsAppClient).sendText(eq("+237690000000"), anyString());
        }

        @Test
        void shouldHandleNullMetadataGracefully() {
            // given
            PaymentRecord record = PaymentRecord.builder()
                    .transactionId("txn-1")
                    .customerPhone("+237690000000")
                    .metadata(null)
                    .build();

            // when
            laundryBot.onPaymentCompleted(record);

            // then
            verify(whatsAppClient, never()).sendText(anyString(), anyString());
        }

        @Test
        void shouldSendReservationConfirmationWhenReservation() {
            // given
            Map<String, Object> metadata = new HashMap<>();
            metadata.put("isReservation", true);
            metadata.put("machineName", "Washer 1");
            metadata.put("machineId", "w1");
            metadata.put("reservationDate", "2026-06-11");
            metadata.put("reservationTime", "10:00");
            metadata.put("language", "EN");

            Map<String, Object> reservationResponse = new HashMap<>();
            reservationResponse.put("reservationCode", "ABC123");
            reservationResponse.put("transactionReference", "ref-1");

            when(machineService.createReservation("w1", "+237690000000", "2026-06-11T10:00:00"))
                    .thenReturn(reservationResponse);
            when(machineService.activateReservation("ref-1")).thenReturn(null);

            PaymentRecord record = PaymentRecord.builder()
                    .transactionId("txn-1")
                    .customerPhone("+237690000000")
                    .amount(500)
                    .botId("test-laundry")
                    .metadata(metadata)
                    .build();

            // when
            laundryBot.onPaymentCompleted(record);

            // then
            verify(machineService).createReservation("w1", "+237690000000", "2026-06-11T10:00:00");
            verify(machineService).activateReservation("ref-1");
            verify(whatsAppClient).sendText(eq("+237690000000"), anyString());
        }

        @Test
        void shouldHandleReservationCreationFailure() {
            // given
            Map<String, Object> metadata = new HashMap<>();
            metadata.put("isReservation", true);
            metadata.put("machineName", "Washer 1");
            metadata.put("machineId", "w1");
            metadata.put("reservationDate", "2026-06-11");
            metadata.put("reservationTime", "10:00");
            metadata.put("language", "EN");

            when(machineService.createReservation("w1", "+237690000000", "2026-06-11T10:00:00"))
                    .thenReturn(null);

            PaymentRecord record = PaymentRecord.builder()
                    .transactionId("txn-1")
                    .customerPhone("+237690000000")
                    .amount(500)
                    .botId("test-laundry")
                    .metadata(metadata)
                    .build();

            // when
            laundryBot.onPaymentCompleted(record);

            // then
            verify(whatsAppClient).sendText(eq("+237690000000"), anyString());
        }

        @Test
        void shouldUseDefaultMachineNameWhenMissing() {
            // given
            Map<String, Object> metadata = new HashMap<>();
            metadata.put("duration", 30);
            metadata.put("language", "EN");

            PaymentRecord record = PaymentRecord.builder()
                    .transactionId("txn-1")
                    .customerPhone("+237690000000")
                    .amount(1000)
                    .botId("test-laundry")
                    .metadata(metadata)
                    .build();

            // when
            laundryBot.onPaymentCompleted(record);

            // then
            verify(whatsAppClient).sendText(eq("+237690000000"), anyString());
        }

        @Test
        void shouldDefaultToEnglishWhenLanguageInvalid() {
            // given
            Map<String, Object> metadata = new HashMap<>();
            metadata.put("machineName", "Washer 1");
            metadata.put("duration", 30);
            metadata.put("language", "INVALID");

            PaymentRecord record = PaymentRecord.builder()
                    .transactionId("txn-1")
                    .customerPhone("+237690000000")
                    .amount(1000)
                    .botId("test-laundry")
                    .metadata(metadata)
                    .build();

            // when
            laundryBot.onPaymentCompleted(record);

            // then
            verify(whatsAppClient).sendText(eq("+237690000000"), anyString());
        }

        @Test
        void shouldDefaultToEnglishWhenLanguageNotString() {
            // given
            Map<String, Object> metadata = new HashMap<>();
            metadata.put("machineName", "Washer 1");
            metadata.put("duration", 30);
            metadata.put("language", 42);

            PaymentRecord record = PaymentRecord.builder()
                    .transactionId("txn-1")
                    .customerPhone("+237690000000")
                    .amount(1000)
                    .botId("test-laundry")
                    .metadata(metadata)
                    .build();

            // when
            laundryBot.onPaymentCompleted(record);

            // then
            verify(whatsAppClient).sendText(eq("+237690000000"), anyString());
        }
    }

    @Nested
    class SendProactiveNotification {

        @Test
        void shouldSendTranslatedMessageInStoredLanguage() {
            // given — customer's last conversation was in French
            com.botmanager.core.flow.ConversationState state = new com.botmanager.core.flow.ConversationState();
            state.setContextValue("language", "fr");
            when(redisManager.get("conv:test-laundry:+237690000000", com.botmanager.core.flow.ConversationState.class))
                    .thenReturn(java.util.Optional.of(state));

            // when
            laundryBot.sendProactiveNotification("+237690000000", "status_none", Map.of());

            // then
            verify(whatsAppClient).sendText(eq("+237690000000"), contains("aucun cycle"));
        }

        @Test
        void shouldDefaultToEnglishWhenNoStoredConversation() {
            // given — no prior conversation for this phone
            when(redisManager.get("conv:test-laundry:+237699999999", com.botmanager.core.flow.ConversationState.class))
                    .thenReturn(java.util.Optional.empty());

            // when
            laundryBot.sendProactiveNotification("+237699999999", "status_none", Map.of());

            // then
            verify(whatsAppClient).sendText(eq("+237699999999"), contains("don't have any active"));
        }
    }

    @Nested
    class OnPaymentFailed {

        @Test
        void shouldSendPaymentFailedMessage() {
            // given
            Map<String, Object> metadata = new HashMap<>();
            metadata.put("machineName", "Washer 1");
            metadata.put("language", "EN");

            PaymentRecord record = PaymentRecord.builder()
                    .transactionId("txn-1")
                    .customerPhone("+237690000000")
                    .amount(1000)
                    .botId("test-laundry")
                    .metadata(metadata)
                    .raw(null)
                    .build();

            // when
            laundryBot.onPaymentFailed(record);

            // then
            verify(whatsAppClient).sendText(eq("+237690000000"), anyString());
        }

        @Test
        void shouldHandleNullMetadataOnFailure() {
            // given
            PaymentRecord record = PaymentRecord.builder()
                    .transactionId("txn-1")
                    .customerPhone("+237690000000")
                    .metadata(null)
                    .build();

            // when
            laundryBot.onPaymentFailed(record);

            // then
            verify(whatsAppClient, never()).sendText(anyString(), anyString());
        }

        @ParameterizedTest
        @ValueSource(strings = {"cancelled by user", "cancel"})
        void shouldExtractCancelledReasonFromRaw(String reason) {
            // given
            Map<String, Object> metadata = new HashMap<>();
            metadata.put("machineName", "Washer 1");
            metadata.put("language", "EN");

            Map<String, Object> raw = new HashMap<>();
            raw.put("reason", reason);

            PaymentRecord record = PaymentRecord.builder()
                    .transactionId("txn-1")
                    .customerPhone("+237690000000")
                    .amount(1000)
                    .botId("test-laundry")
                    .metadata(metadata)
                    .raw(raw)
                    .build();

            // when
            laundryBot.onPaymentFailed(record);

            // then
            verify(whatsAppClient).sendText(eq("+237690000000"), anyString());
        }

        @ParameterizedTest
        @ValueSource(strings = {"timeout", "expired", "timed out"})
        void shouldExtractTimeoutReasonFromRaw(String reason) {
            // given
            Map<String, Object> metadata = new HashMap<>();
            metadata.put("machineName", "Washer 1");
            metadata.put("language", "EN");

            Map<String, Object> raw = new HashMap<>();
            raw.put("failure_reason", reason);

            PaymentRecord record = PaymentRecord.builder()
                    .transactionId("txn-1")
                    .customerPhone("+237690000000")
                    .amount(1000)
                    .botId("test-laundry")
                    .metadata(metadata)
                    .raw(raw)
                    .build();

            // when
            laundryBot.onPaymentFailed(record);

            // then
            verify(whatsAppClient).sendText(eq("+237690000000"), anyString());
        }

        @Test
        void shouldExtractInsufficientFundsReason() {
            // given
            Map<String, Object> metadata = new HashMap<>();
            metadata.put("machineName", "Washer 1");
            metadata.put("language", "EN");

            Map<String, Object> raw = new HashMap<>();
            raw.put("message", "insufficient balance");

            PaymentRecord record = PaymentRecord.builder()
                    .transactionId("txn-1")
                    .customerPhone("+237690000000")
                    .amount(1000)
                    .botId("test-laundry")
                    .metadata(metadata)
                    .raw(raw)
                    .build();

            // when
            laundryBot.onPaymentFailed(record);

            // then
            verify(whatsAppClient).sendText(eq("+237690000000"), anyString());
        }

        @Test
        void shouldExtractDeclinedReason() {
            // given
            Map<String, Object> metadata = new HashMap<>();
            metadata.put("machineName", "Washer 1");
            metadata.put("language", "EN");

            Map<String, Object> raw = new HashMap<>();
            raw.put("reason", "declined");

            PaymentRecord record = PaymentRecord.builder()
                    .transactionId("txn-1")
                    .customerPhone("+237690000000")
                    .amount(1000)
                    .botId("test-laundry")
                    .metadata(metadata)
                    .raw(raw)
                    .build();

            // when
            laundryBot.onPaymentFailed(record);

            // then
            verify(whatsAppClient).sendText(eq("+237690000000"), anyString());
        }

        @Test
        void shouldHandleRawWithNoReasonKeys() {
            // given
            Map<String, Object> metadata = new HashMap<>();
            metadata.put("machineName", "Washer 1");
            metadata.put("language", "EN");

            Map<String, Object> raw = new HashMap<>();
            raw.put("unrelated", "data");

            PaymentRecord record = PaymentRecord.builder()
                    .transactionId("txn-1")
                    .customerPhone("+237690000000")
                    .amount(1000)
                    .botId("test-laundry")
                    .metadata(metadata)
                    .raw(raw)
                    .build();

            // when
            laundryBot.onPaymentFailed(record);

            // then
            verify(whatsAppClient).sendText(eq("+237690000000"), anyString());
        }
    }
}
