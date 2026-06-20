package com.botmanager.bots.thomasnetwork;

import com.botmanager.core.bot.BotConfig;
import com.botmanager.core.flow.FlowContext;
import com.botmanager.core.flow.FlowPlugin;
import com.botmanager.core.flow.FlowState;
import com.botmanager.core.i18n.Language;
import com.botmanager.core.i18n.TranslationService;
import com.botmanager.core.payment.PaymentGateway;
import com.botmanager.core.payment.PaymentRequest;
import com.botmanager.core.payment.PaymentResult;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Slf4j
@RequiredArgsConstructor
public class ThomasNetworkFlowPlugin extends FlowPlugin {

    private final PaymentGateway paymentGateway;
    private final TranslationService translationService;

    private Language getLang(FlowContext context) {
        Object langObj = context.get("language");
        return langObj instanceof Language lang ? lang : Language.EN;
    }

    private static final List<BandwidthOption> BANDWIDTH_OPTIONS = List.of(
            new BandwidthOption("bw_10", "10 Gigabit/s", 4, 10),
            new BandwidthOption("bw_5", "5 Gigabit/s", 2, 5)
    );

    @Override
    public void handleAction(String action, Map<String, Object> params, FlowContext context) {
        log.debug("ThomasNetworkFlowPlugin handling action: {}", action);

        switch (action) {
            case "menu.route" -> handleMenuRoute(context);
            case "bandwidth.list" -> handleListBandwidth(context);
            case "bandwidth.validate" -> handleValidateBandwidth(context);
            case "devices.calculate" -> handleCalculateDevices(context);
            case "payments.initiate" -> handleInitiatePayment(context);
            case "pressing.route" -> handlePressingRoute(context);
            case "pressing.tracking" -> handlePressingTracking(context);
            default -> log.warn("Unknown action: {}", action);
        }
    }

    private void handleMenuRoute(FlowContext context) {
        String menuChoice = context.getString("menuChoice");

        if (menuChoice == null) {
            goTo(context, "main_menu");

            return;
        }

        String normalized = menuChoice.trim().toLowerCase();

        switch (normalized) {
            case "1", "access_network" -> goTo(context, "bandwidth_list_action");
            case "2", "help", "aide" -> goTo(context, "help_message");
            case "3", "pressing" -> goTo(context, "pressing_menu");
            default -> goTo(context, "main_menu");
        }
    }

    private void handlePressingRoute(FlowContext context) {
        String choice = context.getString("pressingChoice");

        if (choice == null) {
            goTo(context, "pressing_menu");
            return;
        }

        String normalized = choice.trim().toLowerCase();

        switch (normalized) {
            case "menu" -> goTo(context, "main_menu");
            case "pressing_machines" -> goTo(context, "pressing_machines_message");
            case "pressing_tracking" -> goTo(context, "pressing_tracking_prompt");
            default -> goTo(context, "pressing_menu");
        }
    }

    private void handlePressingTracking(FlowContext context) {
        String code = context.getString("pressingTrackingCode");

        String normalized = code != null ? code.trim() : "";

        // Always respond with the same flow layout as the screenshot: message + submenu buttons.
        String result;
        if (normalized.isBlank()) {
            result = "\uD83C\uDFF7\uFE0F Suivi Pressing\n\n" +
                    "\u2753 Code invalide.\n" +
                    "V\u00E9rifie le code ou contacte le personnel.\n\n" +
                    "Choisis une option :";
        } else {
            result = "\uD83C\uDFF7\uFE0F Suivi Pressing\n\n" +
                    "\u2753 Code " + normalized + " introuvable.\n" +
                    "V\u00E9rifie le code ou contacte le personnel.\n\n" +
                    "Choisis une option :";
        }

        context.set("pressingTrackingResult", result);
        context.set("pressingButtons", buildPressingButtons());
        goTo(context, "pressing_tracking_result");
    }

    private List<FlowState.ButtonOption> buildPressingButtons() {
        List<FlowState.ButtonOption> buttons = new ArrayList<>();

        FlowState.ButtonOption machines = new FlowState.ButtonOption();
        machines.setId("pressing_machines");
        machines.setTitle("Machines dispo");
        buttons.add(machines);

        FlowState.ButtonOption tracking = new FlowState.ButtonOption();
        tracking.setId("pressing_tracking");
        tracking.setTitle("Suivi code");
        buttons.add(tracking);

        FlowState.ButtonOption menu = new FlowState.ButtonOption();
        menu.setId("menu");
        menu.setTitle("Menu");
        buttons.add(menu);

        return buttons;
    }

    private void handleListBandwidth(FlowContext context) {
        StringBuilder messageBuilder = new StringBuilder();
        messageBuilder.append("\uD83D\uDCE1 *Choix du d\u00E9bit (1 journ\u00E9e)*\n\n");
        messageBuilder.append("Appuie sur un bouton :");

        List<FlowState.ButtonOption> buttons = new ArrayList<>();

        for (BandwidthOption option : BANDWIDTH_OPTIONS) {
            FlowState.ButtonOption button = new FlowState.ButtonOption();
            button.setId(option.id());
            button.setTitle(option.label() + " - " + option.basePrice() + " XAF");
            buttons.add(button);
        }

        FlowState.ButtonOption menuButton = new FlowState.ButtonOption();
        menuButton.setId("menu");
        menuButton.setTitle("Menu");
        buttons.add(menuButton);

        context.set("bandwidthMessage", messageBuilder.toString());
        context.set("bandwidthButtons", buttons);
        goTo(context, "bandwidth_buttons");
    }

    private void handleValidateBandwidth(FlowContext context) {
        String bandwidthChoice = context.getString("bandwidthChoiceInput");

        if (bandwidthChoice == null) {
            goTo(context, "bandwidth_invalid");

            return;
        }

        String normalized = bandwidthChoice.trim().toLowerCase();

        if ("menu".equals(normalized)) {
            goTo(context, "main_menu");
            return;
        }

        // Accept button ids (bw_10 / bw_5) and keep numeric compatibility (1/2)
        BandwidthOption selected = null;

        for (BandwidthOption option : BANDWIDTH_OPTIONS) {
            if (option.id().equalsIgnoreCase(normalized)) {
                selected = option;
                break;
            }
        }

        if (selected == null) {
            try {
                int choiceIndex = Integer.parseInt(normalized) - 1;
                if (choiceIndex >= 0 && choiceIndex < BANDWIDTH_OPTIONS.size()) {
                    selected = BANDWIDTH_OPTIONS.get(choiceIndex);
                }
            } catch (NumberFormatException exception) {
                log.debug("Invalid bandwidth choice: {}", bandwidthChoice);
            }
        }

        if (selected != null) {
            context.set("bandwidthId", selected.id());
            context.set("bandwidthLabel", selected.label());
            context.set("bandwidthBasePrice", selected.basePrice());
            context.set("bandwidthSpeed", selected.speedGbps());
            goTo(context, "devices_prompt");
            return;
        }

        goTo(context, "bandwidth_invalid");
    }

    private void handleCalculateDevices(FlowContext context) {
        String deviceCountInput = context.getString("deviceCountInput");
        Object basePriceObj = context.get("bandwidthBasePrice");
        String bandwidthId = context.getString("bandwidthId");
        String bandwidthLabel = context.getString("bandwidthLabel");

        if (deviceCountInput == null || basePriceObj == null) {
            goTo(context, "devices_invalid");

            return;
        }

        try {
            int deviceCount = Integer.parseInt(deviceCountInput.trim());

            if (deviceCount < 1 || deviceCount > 10) {
                context.set("devicesError", "Please enter a number between 1 and 10");
                goTo(context, "devices_invalid");

                return;
            }

            int basePrice = basePriceObj instanceof Number ? ((Number) basePriceObj).intValue() : 0;
            int totalPrice = basePrice * deviceCount;

            String bandwidthRef = "bw_10".equalsIgnoreCase(bandwidthId) ? "10gbps" : "5gbps";
            String reference = "thomas_network-" + bandwidthRef + "-" + System.currentTimeMillis();
            context.set("paymentReference", reference);

            context.set("deviceCount", deviceCount);
            context.set("totalPrice", totalPrice);
            context.set("paymentAmount", totalPrice);
            context.set("paymentCurrency", "XAF");

                String summary = String.format(
                    "\uD83D\uDCB3 Paiement Mobile Money\n\n" +
                        "Service: \uD83C\uDF10 Acc\u00E8s r\u00E9seau (1 journ\u00E9e)\n" +
                        "D\u00E9bit: %s\n" +
                        "Appareils: %d\n" +
                        "Total: %d XAF\n\n" +
                        "R\u00E9f\u00E9rence: %s\n\n" +
                        "Une demande de paiement peut s'afficher sur votre t\u00E9l\u00E9phone. Une fois pay\u00E9, je vous enverrai votre code d'acc\u00E8s ici.",
                    bandwidthLabel != null ? bandwidthLabel : "",
                    deviceCount,
                    totalPrice,
                    reference
                );
            context.set("orderSummary", summary);

            goTo(context, "payment_confirm");
        } catch (NumberFormatException exception) {
            context.set("devicesError", "Please enter a valid number");
            goTo(context, "devices_invalid");
        }
    }

    private void handleInitiatePayment(FlowContext context) {
        BotConfig botConfig = (BotConfig) context.get("botConfig");
        String customerPhone = context.getString("customerPhone");
        String bandwidthId = context.getString("bandwidthId");
        String bandwidthLabel = context.getString("bandwidthLabel");
        Object deviceCountObj = context.get("deviceCount");
        Object amountObj = context.get("paymentAmount");
        String currency = context.getString("paymentCurrency");

        int amount = amountObj instanceof Number ? ((Number) amountObj).intValue() : 0;
        int deviceCount = deviceCountObj instanceof Number ? ((Number) deviceCountObj).intValue() : 1;

        String referenceFromContext = context.getString("paymentReference");
        String reference = referenceFromContext != null && !referenceFromContext.isBlank()
            ? referenceFromContext
            : botConfig.getBotId() + "-" + bandwidthId + "-" + System.currentTimeMillis();

        Map<String, Object> metadata = new HashMap<>();
        metadata.put("bandwidthId", bandwidthId);
        metadata.put("deviceCount", deviceCount);
        metadata.put("customerPhone", customerPhone);
        metadata.put("language", getLang(context).name());
        metadata.put("serviceLabel", bandwidthLabel != null ? bandwidthLabel : bandwidthId);

        PaymentRequest request = PaymentRequest.builder()
                .botId(botConfig.getBotId())
                .amount(amount)
                .currency(currency)
                .phoneNumber(customerPhone)
                .reference(reference)
            .description("Acc\u00E8s r\u00E9seau - " + (bandwidthLabel != null ? bandwidthLabel : bandwidthId) + " - " + deviceCount + " appareil(s)")
                .metadata(metadata)
                .build();

        PaymentResult result = paymentGateway.initiatePayment(request);

        if (result.success()) {
            context.set("transactionId", result.transactionId());
            context.set("paymentStatus", result.status().getValue());
            goTo(context, "payment_pending");
        } else {
            context.set("paymentError", toUserFacingError(result.errorMessage(), getLang(context)));
            goTo(context, "payment_failed");
        }
    }

    private String toUserFacingError(String raw, Language lang) {
        if (raw == null || raw.isBlank()) {
            return translationService.translate("campay_err_generic", lang);
        }
        if (raw.contains("<html") || raw.contains("<!DOCTYPE")) {
            return translationService.translate("campay_err_unavailable", lang);
        }
        String errorCode = extractJsonField(raw, "error_code");
        if (errorCode != null) {
            String translationKey = "campay_err_" + errorCode;
            String translated = translationService.translate(translationKey, lang);
            return translationKey.equals(translated)
                    ? translationService.translate("campay_err_default", lang)
                    : translated;
        }
        return raw.length() > 200 ? raw.substring(0, 200) + "\u2026" : raw;
    }

    private String extractJsonField(String text, String fieldName) {
        String key = "\"" + fieldName + "\":\"";
        int start = text.indexOf(key);
        if (start < 0) return null;
        start += key.length();
        int end = text.indexOf('"', start);
        if (end < 0) return null;
        return text.substring(start, end);
    }

    private record BandwidthOption(String id, String label, int basePrice, int speedGbps) {}

}
