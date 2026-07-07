package com.botmanager.notification;

import com.botmanager.core.bot.BaseBot;
import com.botmanager.core.bot.BotLookup;
import com.botmanager.core.bot.ProactiveNotifier;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.Optional;

/**
 * Lets other services (MachineStateService, PaymentManagementService) ask a bot to
 * proactively push a WhatsApp message to a customer — e.g. a cycle-almost-done
 * reminder or a post-cycle feedback prompt — outside of any inbound conversation.
 * Requires the {@code sls-bot-admin} scope (see SecurityConfig).
 */
@Slf4j
@RestController
@RequestMapping("/api/notifications")
@RequiredArgsConstructor
public class NotificationController {

    private final BotLookup botLookup;

    @PostMapping("/send")
    public ResponseEntity<?> send(@RequestBody NotificationDtos.SendRequest request) {
        if (!StringUtils.hasText(request.getBotId())) {
            return badRequest("botId is required");
        }
        if (!StringUtils.hasText(request.getPhone())) {
            return badRequest("phone is required");
        }
        if (!StringUtils.hasText(request.getMessageKey())) {
            return badRequest("messageKey is required");
        }

        Optional<BaseBot> bot = botLookup.getBotByName(request.getBotId());
        if (bot.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(
                    NotificationDtos.ErrorResponse.builder()
                            .error("Not Found")
                            .detail("Unknown bot: " + request.getBotId())
                            .build());
        }

        if (!(bot.get() instanceof ProactiveNotifier notifier)) {
            return ResponseEntity.status(HttpStatus.NOT_IMPLEMENTED).body(
                    NotificationDtos.ErrorResponse.builder()
                            .error("Not Implemented")
                            .detail("Bot '" + request.getBotId() + "' does not support proactive notifications")
                            .build());
        }

        notifier.sendProactiveNotification(request.getPhone(), request.getMessageKey(), request.getParams());

        return ResponseEntity.ok(Map.of("status", "sent"));
    }

    private ResponseEntity<NotificationDtos.ErrorResponse> badRequest(String detail) {
        return ResponseEntity.badRequest().body(
                NotificationDtos.ErrorResponse.builder()
                        .error("Bad Request")
                        .detail(detail)
                        .build());
    }
}
