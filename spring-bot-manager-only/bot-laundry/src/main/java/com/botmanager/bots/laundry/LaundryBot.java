package com.botmanager.bots.laundry;

import com.botmanager.core.bot.BaseBot;
import com.botmanager.core.flow.FlowEngine;
import com.botmanager.core.flow.FlowPlugin;
import com.botmanager.core.i18n.Language;
import com.botmanager.core.i18n.TranslationService;
import com.botmanager.core.machine.MachineService;
import com.botmanager.core.payment.PaymentGateway;
import com.botmanager.core.payment.PaymentRecord;
import com.botmanager.core.redis.RedisManager;
import com.botmanager.core.whatsapp.WhatsAppClientFactory;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;

import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Map;

@Slf4j
public class LaundryBot extends BaseBot {

    private static final ZoneId DOUALA_ZONE = ZoneId.of("Africa/Douala");
    private static final DateTimeFormatter TIME_FMT = DateTimeFormatter.ofPattern("HH:mm");

    private final LaundryFlowPlugin plugin;
    private final TranslationService translationService;
    private final MachineService machineService;

    public LaundryBot(LaundryBotConfig config,
                      FlowEngine flowEngine,
                      RedisManager redisManager,
                      WhatsAppClientFactory whatsAppClientFactory,
                      ObjectMapper objectMapper,
                      PaymentGateway paymentGateway,
                      MachineService machineService,
                      TranslationService translationService,
                      PricingClient pricingClient,
                      TransactionClient transactionClient) {

        super(config, flowEngine, redisManager, whatsAppClientFactory, objectMapper);
        this.translationService = translationService;
        this.machineService = machineService;
        this.plugin = new LaundryFlowPlugin(paymentGateway, machineService, translationService, config, pricingClient, transactionClient);

        machineService.registerBot(config);

        log.info("LaundryBot initialized: {}", config.getBotId());
    }

    @Override
    public FlowPlugin getPlugin() {
        return plugin;
    }

    @Override
    public void onPaymentCompleted(PaymentRecord record) {
        Map<String, Object> metadata = record.getMetadata();
        if (metadata == null) {
            log.warn("Payment completed but metadata is null, transactionId={}", record.getTransactionId());
            return;
        }

        boolean isReservation = Boolean.TRUE.equals(metadata.get("isReservation"));
        if (isReservation) {
            handleReservationPaymentCompleted(record, metadata);
        } else {
            handleWashPaymentCompleted(record, metadata);
        }
    }

    private void handleWashPaymentCompleted(PaymentRecord record, Map<String, Object> metadata) {
        String customerPhone = record.getCustomerPhone();
        Language lang = resolveLanguage(metadata);
        String machineName = (String) metadata.getOrDefault("machineName", "machine");
        int duration = ((Number) metadata.getOrDefault("duration", 30)).intValue();

        ZonedDateTime endTime = Instant.now().plusSeconds(duration * 60L).atZone(DOUALA_ZONE);
        String endTimeStr = endTime.format(TIME_FMT);

        String message = translationService.translate("payment_confirmed", lang, Map.of(
                "amount", record.getAmount(),
                "machine", machineName,
                "duration", duration,
                "endTime", endTimeStr
        ));

        log.info("Sending wash payment confirmed to {} for bot {}, machine={}",
                customerPhone, config.getBotId(), machineName);
        sendMessage(customerPhone, message);
    }

    private void handleReservationPaymentCompleted(PaymentRecord record, Map<String, Object> metadata) {
        String customerPhone = record.getCustomerPhone();
        Language lang = resolveLanguage(metadata);
        String machineName = (String) metadata.getOrDefault("machineName", "machine");
        String machineId = (String) metadata.get("machineId");
        String reservationDate = (String) metadata.get("reservationDate");
        String reservationTime = (String) metadata.get("reservationTime");

        log.info("Reservation payment confirmed for customer={}, machine={}, date={}, time={}",
                customerPhone, machineId, reservationDate, reservationTime);

        // Build the slot start datetime for MachineStateService
        String slotStartIso = reservationDate + "T" + reservationTime + ":00";

        // Create the reservation in MachineStateService
        Map<String, Object> reservationResponse = machineService.createReservation(
                machineId, customerPhone, slotStartIso);

        if (reservationResponse != null) {
            String reservationCode = (String) reservationResponse.get("reservationCode");
            String transactionReference = (String) reservationResponse.get("transactionReference");

            // Activate the reservation immediately since payment is already confirmed
            Map<String, Object> activationResponse = machineService.activateReservation(transactionReference);
            if (activationResponse == null) {
                log.error("Reservation created (code={}) but activation failed for customer={}, machine={}, transactionReference={}",
                        reservationCode, customerPhone, machineId, transactionReference);
                String message = translationService.translate("reservation_creation_failed", lang, Map.of(
                        "machine", machineName
                ));
                sendMessage(customerPhone, message);
                return;
            }

            String message = translationService.translate("reservation_confirmed", lang, Map.of(
                    "machine", machineName,
                    "date", reservationDate != null ? reservationDate : "",
                    "time", reservationTime != null ? reservationTime : "",
                    "code", reservationCode != null ? reservationCode : "",
                    "amount", record.getAmount()
            ));

            log.info("Reservation confirmed: code={}, machine={}, customer={}",
                    reservationCode, machineName, customerPhone);
            sendMessage(customerPhone, message);
        } else {
            log.error("Failed to create reservation after payment for customer={}, machine={}",
                    customerPhone, machineId);
            String message = translationService.translate("reservation_creation_failed", lang, Map.of(
                    "machine", machineName
            ));
            sendMessage(customerPhone, message);
        }
    }

    @Override
    public void onPaymentFailed(PaymentRecord record) {
        Map<String, Object> metadata = record.getMetadata();
        if (metadata == null) return;

        String customerPhone = record.getCustomerPhone();
        Language lang = resolveLanguage(metadata);
        String machineName = (String) metadata.getOrDefault("machineName", "machine");
        String reason = extractFailureReason(record, lang);

        String message = translationService.translate("payment_failed_notification", lang, Map.of(
                "machine", machineName,
                "reason", reason
        ));

        log.info("Sending payment failed to {} for bot {}", customerPhone, config.getBotId());
        sendMessage(customerPhone, message);
    }

    private Language resolveLanguage(Map<String, Object> metadata) {
        Object langObj = metadata.get("language");
        if (langObj instanceof String langStr) {
            try {
                return Language.valueOf(langStr);
            } catch (IllegalArgumentException ignored) {
            }
        }
        return Language.EN;
    }

    private String extractFailureReason(PaymentRecord record, Language lang) {
        Map<String, Object> raw = record.getRaw();
        String rawReason = null;
        if (raw != null) {
            for (String key : new String[]{"reason", "failure_reason", "failureReason", "message"}) {
                Object val = raw.get(key);
                if (val instanceof String s && !s.isBlank()) {
                    rawReason = s.toLowerCase();
                    break;
                }
            }
        }
        if (rawReason == null) {
            return translationService.translate("failure_reason_unknown", lang);
        }
        if (rawReason.contains("cancel")) {
            return translationService.translate("failure_reason_cancelled", lang);
        }
        if (rawReason.contains("timeout") || rawReason.contains("expired") || rawReason.contains("timed")) {
            return translationService.translate("failure_reason_timeout", lang);
        }
        if (rawReason.contains("insufficient") || rawReason.contains("balance") || rawReason.contains("funds")) {
            return translationService.translate("failure_reason_insufficient_funds", lang);
        }
        if (rawReason.contains("declined") || rawReason.contains("refused")) {
            return translationService.translate("failure_reason_declined", lang);
        }
        return translationService.translate("failure_reason_unknown", lang);
    }

}
