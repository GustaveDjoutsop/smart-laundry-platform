package com.botmanager.bots.laundry;

import com.botmanager.core.i18n.Language;
import com.botmanager.core.i18n.TranslationService;
import com.botmanager.core.redis.RedisManager;
import com.botmanager.core.whatsapp.WhatsAppClient;
import com.botmanager.core.whatsapp.WhatsAppClientFactory;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Slf4j
@Service
@RequiredArgsConstructor
public class FeedbackService {

    private static final String FEEDBACK_KEY_PREFIX = "feedback:";

    private static final int FEEDBACK_TTL_HOURS = 168; // 7 days

    private static final int MAX_COMMENT_WORDS = 100;

    private static final DateTimeFormatter TIME_FORMATTER = DateTimeFormatter.ofPattern("HH:mm");

    private final RedisManager redisManager;

    private final TranslationService translationService;

    private final WhatsAppClientFactory whatsAppClientFactory;

    private final ObjectMapper objectMapper;

    public FeedbackRecord saveFeedback(FeedbackRecord feedback) {
        if (feedback.getId() == null) {
            feedback.setId(UUID.randomUUID().toString());
        }

        if (feedback.getSubmittedAt() == null) {
            feedback.setSubmittedAt(Instant.now());
        }

        try {
            String key = FEEDBACK_KEY_PREFIX + feedback.getId();
            String json = objectMapper.writeValueAsString(feedback);
            redisManager.setWithExpiry(key, json, FEEDBACK_TTL_HOURS * 3600L);

            log.info("Feedback saved: id={}, rating={}, botId={}",
                    feedback.getId(), feedback.getRating(), feedback.getBotId());

            return feedback;
        } catch (JsonProcessingException exception) {
            log.error("Failed to serialize feedback: {}", exception.getMessage());

            return null;
        }
    }

    public Optional<FeedbackRecord> getFeedback(String feedbackId) {
        String key = FEEDBACK_KEY_PREFIX + feedbackId;
        Optional<String> jsonOpt = redisManager.get(key);

        if (jsonOpt.isEmpty()) {
            return Optional.empty();
        }

        try {
            return Optional.of(objectMapper.readValue(jsonOpt.get(), FeedbackRecord.class));
        } catch (JsonProcessingException exception) {
            log.error("Failed to deserialize feedback: {}", exception.getMessage());

            return Optional.empty();
        }
    }

    public FeedbackResult processRating(String botId, String customerPhone, String transactionId,
                                        String machineId, String machineName, int rating, Language language) {
        FeedbackRecord feedback = FeedbackRecord.builder()
                .botId(botId)
                .customerPhone(customerPhone)
                .transactionId(transactionId)
                .machineId(machineId)
                .machineName(machineName)
                .rating(rating)
                .submittedAt(Instant.now())
                .build();

        saveFeedback(feedback);

        if (rating == 5) {
            return FeedbackResult.builder()
                    .success(true)
                    .needsComment(false)
                    .feedbackId(feedback.getId())
                    .message(translationService.translate("feedback_thanks_high", language))
                    .build();
        }

        return FeedbackResult.builder()
                .success(true)
                .needsComment(true)
                .feedbackId(feedback.getId())
                .message(translationService.translate("feedback_thanks_low", language))
                .build();
    }

    public FeedbackResult processComment(String feedbackId, String comment, Language language) {
        Optional<FeedbackRecord> optionalFeedback = getFeedback(feedbackId);

        if (optionalFeedback.isEmpty()) {
            return FeedbackResult.builder()
                    .success(false)
                    .message(translationService.translate("session_error", language))
                    .build();
        }

        int wordCount = countWords(comment);
        if (wordCount > MAX_COMMENT_WORDS) {
            return FeedbackResult.builder()
                    .success(false)
                    .tooLong(true)
                    .message(translationService.translate("feedback_comment_too_long", language,
                            Map.of("words", wordCount)))
                    .build();
        }

        FeedbackRecord feedback = optionalFeedback.get();
        feedback.setComment(comment.trim());
        saveFeedback(feedback);

        log.info("Feedback comment saved: id={}, rating={}, wordCount={}",
                feedbackId, feedback.getRating(), wordCount);

        return FeedbackResult.builder()
                .success(true)
                .feedbackId(feedbackId)
                .message(translationService.translate("feedback_comment_received", language))
                .build();
    }

    public FeedbackResult skipComment(String feedbackId, Language language) {
        log.info("Feedback comment skipped: id={}", feedbackId);

        return FeedbackResult.builder()
                .success(true)
                .feedbackId(feedbackId)
                .message(translationService.translate("feedback_skipped", language))
                .build();
    }

    public void sendStaffAlert(LaundryBotConfig config, FeedbackRecord feedback) {
        Map<String, Object> vars = new HashMap<>();
        String machine = feedback.getMachineName() != null ? feedback.getMachineName() : feedback.getMachineId();
        vars.put("machine", machine != null ? machine : "unknown");
        vars.put("phone", feedback.getCustomerPhone() != null ? feedback.getCustomerPhone() : "unknown");
        vars.put("rating", feedback.getRating());
        vars.put("comment", feedback.getComment() != null ? feedback.getComment() : "No comment provided");

        boolean sent = sendStaffAlert(config, "staff_alert_low_rating", vars);
        if (sent) {
            feedback.setStaffAlertSent(true);
            saveFeedback(feedback);

            log.info("Staff alert sent for low rating: phone={}, rating={}",
                    feedback.getCustomerPhone(), feedback.getRating());
        }
    }

    /**
     * Sends a staff alert for any translation key, not just low-rating feedback
     * (e.g. reservation-payment-succeeded-but-activation-failed reconciliation
     * alerts). Adds the current business-hours-local {@code time} var if not
     * already present in {@code vars}.
     *
     * @return true if the message was sent, false if no staff phone is configured
     *         or the send failed
     */
    public boolean sendStaffAlert(LaundryBotConfig config, String translationKey, Map<String, Object> vars) {
        String staffPhone = config.getStaffAlertPhone();

        if (staffPhone == null || staffPhone.isBlank()) {
            log.warn("No staff alert phone configured for bot: {}", config.getBotId());

            return false;
        }

        try {
            WhatsAppClient client = whatsAppClientFactory.getClient(config.getBotId(), config.getPhoneNumberId());

            String currentTime = ZonedDateTime.now(ZoneId.of(config.getBusinessHours().getTimezone()))
                    .format(TIME_FORMATTER);

            Map<String, Object> allVars = new HashMap<>(vars);
            allVars.putIfAbsent("time", currentTime);

            String message = translationService.translate(translationKey, Language.EN, allVars);

            client.sendText(staffPhone, message);

            log.info("Staff alert sent: key={}, phone={}", translationKey, staffPhone);
            return true;
        } catch (Exception exception) {
            log.error("Failed to send staff alert: {}", exception.getMessage());
            return false;
        }
    }

    private int countWords(String text) {
        if (text == null || text.isBlank()) {
            return 0;
        }

        return text.trim().split("\\s+").length;
    }

    @lombok.Builder
    @lombok.Getter
    public static class FeedbackResult {

        private final boolean success;

        private final boolean needsComment;

        private final boolean tooLong;

        private final String feedbackId;

        private final String message;
    }

}
