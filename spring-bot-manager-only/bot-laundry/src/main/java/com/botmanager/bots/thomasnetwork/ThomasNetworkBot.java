package com.botmanager.bots.thomasnetwork;

import com.botmanager.core.bot.BaseBot;
import com.botmanager.core.bot.BotConfig;
import com.botmanager.core.flow.FlowEngine;
import com.botmanager.core.flow.FlowPlugin;
import com.botmanager.core.i18n.Language;
import com.botmanager.core.i18n.TranslationService;
import com.botmanager.core.payment.PaymentGateway;
import com.botmanager.core.payment.PaymentRecord;
import com.botmanager.core.redis.RedisManager;
import com.botmanager.core.whatsapp.WhatsAppClientFactory;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;

import java.util.Map;

@Slf4j
public class ThomasNetworkBot extends BaseBot {

    private final ThomasNetworkFlowPlugin plugin;
    private final TranslationService translationService;

    public ThomasNetworkBot(BotConfig config,
                           FlowEngine flowEngine,
                           RedisManager redisManager,
                           WhatsAppClientFactory whatsAppClientFactory,
                           ObjectMapper objectMapper,
                           PaymentGateway paymentGateway,
                           TranslationService translationService) {

        super(config, flowEngine, redisManager, whatsAppClientFactory, objectMapper);
        this.translationService = translationService;
        this.plugin = new ThomasNetworkFlowPlugin(paymentGateway, translationService);

        log.info("ThomasNetworkBot initialized: {}", config.getBotId());
    }

    @Override
    public FlowPlugin getPlugin() {
        return plugin;
    }

    @Override
    public void onPaymentCompleted(PaymentRecord record) {
        Map<String, Object> metadata = record.getMetadata();
        if (metadata == null) return;

        String customerPhone = record.getCustomerPhone();
        Language lang = resolveLanguage(metadata);
        String serviceLabel = (String) metadata.getOrDefault("serviceLabel", "internet");
        int deviceCount = ((Number) metadata.getOrDefault("deviceCount", 1)).intValue();

        String message = translationService.translate("tn_payment_confirmed", lang, Map.of(
                "amount", record.getAmount(),
                "service", serviceLabel,
                "deviceCount", deviceCount
        ));

        log.info("Sending payment confirmed to {} for bot {}", customerPhone, config.getBotId());
        sendMessage(customerPhone, message);
    }

    @Override
    public void onPaymentFailed(PaymentRecord record) {
        Map<String, Object> metadata = record.getMetadata();
        if (metadata == null) return;

        String customerPhone = record.getCustomerPhone();
        Language lang = resolveLanguage(metadata);
        String serviceLabel = (String) metadata.getOrDefault("serviceLabel", "internet");
        String reason = extractFailureReason(record, lang);

        String message = translationService.translate("tn_payment_failed", lang, Map.of(
                "service", serviceLabel,
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
