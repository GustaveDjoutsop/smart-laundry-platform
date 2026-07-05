package com.botmanager.bots.laundry;

import com.botmanager.core.flow.FlowContext;
import com.botmanager.core.flow.FlowPlugin;
import com.botmanager.core.flow.FlowState;
import com.botmanager.core.flow.MessageSender;
import com.botmanager.core.i18n.Language;
import com.botmanager.core.i18n.TranslationService;
import com.botmanager.core.machine.MachineRecord;
import com.botmanager.core.machine.MachineService;
import com.botmanager.core.machine.MachineServiceUnavailableException;
import com.botmanager.core.machine.MachineStatus;
import com.botmanager.core.machine.MachineType;
import com.botmanager.core.payment.PaymentGateway;
import com.botmanager.core.payment.PaymentRequest;
import com.botmanager.core.payment.PaymentResult;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Slf4j
@RequiredArgsConstructor
public class LaundryFlowPlugin extends FlowPlugin {

    private static final Set<String> RESET_COMMANDS = Set.of("hi", "hello", "reset", "cancel", "stop", "action_cancel", "start");

    private static final int MAX_BUTTONS_DISPLAY = 2;

    private final PaymentGateway paymentGateway;

    private final MachineService machineService;

    private final TranslationService translationService;

    private final LaundryBotConfig laundryConfig;

    private final PricingClient pricingClient;

    private BusinessHoursService businessHoursService;

    void setBusinessHoursService(BusinessHoursService businessHoursService) {
        this.businessHoursService = businessHoursService;
    }

    @Override
    public void handleAction(String action, Map<String, Object> params, FlowContext context) {
        log.debug("LaundryFlowPlugin handling action: {}", action);

        initBusinessHoursIfNeeded();

        switch (action) {
            // Language selection
            case "language.show" -> handleShowLanguageSelection(context);
            case "language.process" -> handleProcessLanguageChoice(context);

            // Main menu
            case "menu.show" -> handleShowMainMenu(context);
            case "menu.process" -> handleProcessMenuChoice(context);

            // Services
            case "services.show" -> handleShowServices(context);

            // Machine selection
            case "machines.showMethodSelection" -> handleShowMachineMethodSelection(context);
            case "machines.processMethodSelection" -> handleProcessMachineMethodSelection(context);
            case "machines.showEnterIdPrompt" -> handleShowEnterIdPrompt(context);
            case "machines.processManualId" -> handleProcessManualMachineId(context);
            case "machines.showList" -> handleShowMachineList(context);
            case "machines.processListSelection" -> handleProcessMachineListSelection(context);

            // Cycle selection
            case "cycle.show" -> handleShowCycleSelection(context);
            case "cycle.process" -> handleProcessCycleSelection(context);

            // Payment
            case "payment.initiate" -> handleInitiatePayment(context);

            // Reservation
            case "reservation.showDate" -> handleShowDateSelection(context);
            case "reservation.processDate" -> handleProcessDateSelection(context);
            case "reservation.showTime" -> handleShowTimeSelection(context);
            case "reservation.processTime" -> handleProcessTimeSelection(context);
            case "reservation.confirm" -> handleShowReservationConfirm(context);
            case "reservation.processConfirm" -> handleProcessReservationConfirm(context);
            case "reservation.initiate" -> handleInitiateReservation(context);

            // Status
            case "status.showUserCycle" -> handleShowUserCycleStatus(context);
            case "status.showAvailability" -> handleShowMachineAvailability(context);

            // Feedback
            case "feedback.processRating" -> handleProcessFeedbackRating(context);
            case "feedback.processComment" -> handleProcessFeedbackComment(context);

            default -> log.warn("Unknown action: {}", action);
        }
    }

    private void initBusinessHoursIfNeeded() {
        if (businessHoursService == null) {
            LaundryBotConfig.BusinessHoursConfig hours = laundryConfig.getBusinessHours();
            businessHoursService = new BusinessHoursService(
                    hours.getOpenTime(),
                    hours.getCloseTime(),
                    hours.getClosingBufferMinutes(),
                    hours.getTimezone()
            );
        }
    }

    private Language getLang(FlowContext context) {
        return Language.fromCode(context.getString("language"));
    }

    private String t(String key, FlowContext context) {
        return translationService.translate(key, getLang(context));
    }

    private String t(String key, FlowContext context, Map<String, Object> vars) {
        return translationService.translate(key, getLang(context), vars);
    }

    // ========== Language Selection ==========

    private void handleShowLanguageSelection(FlowContext context) {
        String message = translationService.translate("language_prompt", Language.EN) +
                "\n" + translationService.translate("language_prompt", Language.FR);

        List<FlowState.ButtonOption> buttons = new ArrayList<>();
        buttons.add(createButton("lang_en", translationService.translate("language_english", Language.EN)));
        buttons.add(createButton("lang_fr", translationService.translate("language_french", Language.FR)));

        context.set("responseMessage", message);
        context.set("responseButtons", buttons);
        context.set("step", LaundryStep.AWAITING_LANGUAGE_CHOICE);
    }

    private void handleProcessLanguageChoice(FlowContext context) {
        String input = getInputLower(context);

        if ("lang_en".equals(input) || "english".equals(input) || "en".equals(input)) {
            context.set("language", Language.EN.getCode());
            context.set("step", LaundryStep.MAIN_MENU);
            goTo(context, "main_menu");
        } else if ("lang_fr".equals(input) || "french".equals(input) || "fr".equals(input) || "francais".equals(input)) {
            context.set("language", Language.FR.getCode());
            context.set("step", LaundryStep.MAIN_MENU);
            goTo(context, "main_menu");
        } else if (input != null && input.startsWith("action_")) {
            // User pressed a menu action button while at language selection — their conversation
            // state was likely lost (Redis eviction / redeploy) and WhatsApp showed a stale session.
            // Default to English if no language is set, then fall through to the main menu so
            // the user can re-select from there without being stuck in a language-selection loop.
            if (context.getString("language") == null) {
                context.set("language", Language.EN.getCode());
            }
            context.set("step", LaundryStep.MAIN_MENU);
            log.info("Action button '{}' pressed at language selection; recovering to main_menu (customerPhone={})",
                    input, context.getString("customerPhone"));
            goTo(context, "main_menu");
        } else {
            goTo(context, "language_selection");
        }
    }

    // ========== Main Menu ==========

    private void handleShowMainMenu(FlowContext context) {
        String message = t("welcome", context);

        List<MessageSender.ListRow> rows = new ArrayList<>();
        rows.add(new MessageSender.ListRow("action_wash", t("btn_start_wash", context), null));
        rows.add(new MessageSender.ListRow("action_dry", t("btn_start_dry", context), null));
        rows.add(new MessageSender.ListRow("action_services", t("btn_services", context), null));
        rows.add(new MessageSender.ListRow("action_my_status", t("btn_my_status", context), null));

        MessageSender.ListMessage listMessage = new MessageSender.ListMessage(
                message, t("btn_menu", context), List.of(new MessageSender.ListSection(null, rows)));

        context.set("responseList", listMessage);
        context.set("step", LaundryStep.AWAITING_MENU_CHOICE);
    }

    private void handleProcessMenuChoice(FlowContext context) {
        String input = getInputLower(context);

        switch (input) {
            case "action_services" -> goTo(context, "show_services");
            case "action_wash" -> handleStartCycleFlow(context, MachineType.WASHER);
            case "action_dry" -> handleStartCycleFlow(context, MachineType.DRYER);
            case "action_reservation" -> handleStartReservationFlow(context);
            case "action_my_status" -> goTo(context, "show_user_status");
            case "action_availability" -> goTo(context, "show_availability");
            case "action_cancel" -> goTo(context, "main_menu");
            default -> goTo(context, "main_menu");
        }
    }

    // ========== Services ==========

    private void handleShowServices(FlowContext context) {
        CycleConfig shortCycle = laundryConfig.getShortCycle();
        CycleConfig longCycle = laundryConfig.getLongCycle();

        String message = t("services_title", context) + "\n\n" +
                t("services_washing", context) + "\n" +
                t("services_express", context, Map.of("duration", shortCycle.getDuration(), "price", pricingClient.getShortCyclePrice())) + "\n" +
                t("services_standard", context, Map.of("duration", longCycle.getDuration(), "price", pricingClient.getLongCyclePrice())) + "\n\n" +
                t("services_drying", context) + "\n" +
                t("services_dry_express", context, Map.of("duration", shortCycle.getDuration(), "price", pricingClient.getDryShortPrice())) + "\n" +
                t("services_dry_standard", context, Map.of("duration", longCycle.getDuration(), "price", pricingClient.getDryLongPrice())) + "\n\n" +
                t("services_capacity", context) + "\n\n" +
                t("services_amenities", context) + "\n\n" +
                t("services_ready", context);

        List<MessageSender.ListRow> rows = new ArrayList<>();
        rows.add(new MessageSender.ListRow("action_wash", t("btn_start_wash", context), null));
        rows.add(new MessageSender.ListRow("action_dry", t("btn_start_dry", context), null));
        if (laundryConfig.getFeatures().isReservationEnabled()) {
            rows.add(new MessageSender.ListRow("action_reservation", t("btn_reserve", context), null));
        } else {
            rows.add(new MessageSender.ListRow("action_availability", t("btn_availability", context), null));
        }
        rows.add(new MessageSender.ListRow("action_cancel", t("btn_main_menu", context), null));

        MessageSender.ListMessage listMessage = new MessageSender.ListMessage(
                message, t("btn_menu", context), List.of(new MessageSender.ListSection(null, rows)));

        context.set("responseList", listMessage);
        context.set("step", LaundryStep.AWAITING_MENU_CHOICE);

        goTo(context, "await_menu");
    }

    // ========== Start Wash/Dry Flow ==========

    private void handleStartCycleFlow(FlowContext context, MachineType machineType) {
        // Feature flag: when the wash flow is disabled, users can only check machine
        // availability/info — they cannot select a machine, pick a cycle, or pay from the bot.
        if (!laundryConfig.getFeatures().isWashFlowEnabled()) {
            handleWashFlowDisabled(context);

            return;
        }

        context.set("selectedMachineType", machineType.name());

        int shortestDuration = laundryConfig.getShortCycle().getDuration();
        BusinessHoursService.CycleCheckResult checkResult = businessHoursService.canStartCycle(shortestDuration);
        BusinessHoursService.BusinessHoursInfo hoursInfo = businessHoursService.getBusinessHoursInfo();

        if (!checkResult.isAllowed()) {
            handleBusinessHoursClosed(context, checkResult, hoursInfo);

            goTo(context, "await_menu");

            return;
        }

        List<MachineRecord> availableMachines;
        try {
            availableMachines = getAvailableMachines(machineType);
        } catch (MachineServiceUnavailableException e) {
            showMachineServiceUnavailable(context);
            return;
        }

        if (availableMachines.isEmpty()) {
            log.info("No {} machines available for cycle flow, botId={}", machineType, laundryConfig.getBotId());
            String message = t("no_machines", context);

            List<FlowState.ButtonOption> buttons = new ArrayList<>();
            buttons.add(createButton("action_availability", t("btn_availability", context)));
            buttons.add(createButton("action_cancel", t("btn_back_menu", context)));

            context.set("responseMessage", message);
            context.set("responseButtons", buttons);
            context.set("step", LaundryStep.AWAITING_MENU_CHOICE);

            goTo(context, "await_menu");

            return;
        }

        // Auto-pick the first available machine of the requested type for the user
        MachineRecord autoPickedMachine = availableMachines.getFirst();
        context.set("selectedMachineId", autoPickedMachine.getMachineId());
        context.set("selectedMachineName", autoPickedMachine.getName());
        log.info("Auto-picked {} machine {} ({}) for cycle flow, customerPhone={}",
                machineType, autoPickedMachine.getMachineId(), autoPickedMachine.getName(),
                context.getString("customerPhone"));

        goTo(context, "cycle_selection");
    }

    /**
     * Shown when {@code features.washFlowEnabled} is false. The bot stays read-only:
     * the user is offered availability/info and the main menu, but no path into
     * machine selection, cycle selection, or payment.
     */
    private void handleWashFlowDisabled(FlowContext context) {
        String message = t("wash_flow_disabled", context);

        List<FlowState.ButtonOption> buttons = new ArrayList<>();
        buttons.add(createButton("action_availability", t("btn_availability", context)));
        buttons.add(createButton("action_services", t("btn_services", context)));
        buttons.add(createButton("action_cancel", t("btn_main_menu", context)));

        context.set("responseMessage", message);
        context.set("responseButtons", buttons);
        context.set("step", LaundryStep.AWAITING_MENU_CHOICE);

        goTo(context, "await_menu");
    }

    // ========== Reservation Flow ==========

    private void handleStartReservationFlow(FlowContext context) {
        if (!laundryConfig.getFeatures().isReservationEnabled()) {
            log.debug("Reservation feature is disabled, botId={}", laundryConfig.getBotId());
            String message = t("reservation_disabled", context);
            List<FlowState.ButtonOption> buttons = new ArrayList<>();
            buttons.add(createButton("action_availability", t("btn_availability", context)));
            buttons.add(createButton("action_cancel", t("btn_main_menu", context)));
            context.set("responseMessage", message);
            context.set("responseButtons", buttons);
            context.set("step", LaundryStep.AWAITING_MENU_CHOICE);
            goTo(context, "await_menu");
            return;
        }

        log.info("Starting reservation flow for customerPhone={}", context.getString("customerPhone"));
        context.set("isReservation", true);
        // Skip machine selection — go directly to date selection.
        // The machine will be auto-assigned after the user picks date + time.
        goTo(context, "reservation_date");
    }

    private void handleShowDateSelection(FlowContext context) {
        ZoneId zone = ZoneId.of(laundryConfig.getBusinessHours().getTimezone());
        ZonedDateTime now = ZonedDateTime.now(zone);
        LocalDate today = now.toLocalDate();
        LocalDate tomorrow = today.plusDays(1);

        DateTimeFormatter labelFormatter = DateTimeFormatter.ofPattern("EEE, MMM d");

        // Offer only 2 days: today and tomorrow
        List<FlowState.ButtonOption> buttons = new ArrayList<>();
        String todayLabel = t("reservation_today", context) + ", " + today.format(DateTimeFormatter.ofPattern("MMM d"));
        String tomorrowLabel = tomorrow.format(labelFormatter);
        buttons.add(createButton("res_date_" + today, todayLabel));
        buttons.add(createButton("res_date_" + tomorrow, tomorrowLabel));
        buttons.add(createButton("action_cancel", t("btn_cancel", context)));

        log.debug("Showing reservation date selection: today={}, tomorrow={}", today, tomorrow);

        context.set("responseMessage", t("reservation_select_date_simple", context));
        context.set("responseButtons", buttons);
        context.set("step", LaundryStep.AWAITING_DATE_SELECTION);
    }

    private void handleProcessDateSelection(FlowContext context) {
        String input = context.getString("userInput");
        if ("action_cancel".equals(input)) {
            context.set("isReservation", null);
            goTo(context, "main_menu");
            return;
        }
        if (input != null && input.toLowerCase().startsWith("res_date_")) {
            context.set("reservationDate", input.substring("res_date_".length()));
            goTo(context, "reservation_time");
        } else {
            goTo(context, "reservation_date");
        }
    }

    private static final int MAX_TIME_SLOTS = 3;

    private void handleShowTimeSelection(FlowContext context) {
        String dateStr = context.getString("reservationDate");

        ZoneId zone = ZoneId.of(laundryConfig.getBusinessHours().getTimezone());
        ZonedDateTime now = ZonedDateTime.now(zone);
        LocalDate selectedDate = LocalDate.parse(dateStr);
        LocalTime openTime = LocalTime.parse(laundryConfig.getBusinessHours().getOpenTime());
        LocalTime closeTime = LocalTime.parse(laundryConfig.getBusinessHours().getCloseTime());
        int durationMinutes = laundryConfig.getReservation().getDurationMinutes();
        LocalTime lastStart = closeTime.minusMinutes(durationMinutes);

        LocalTime slot = openTime;
        if (selectedDate.equals(now.toLocalDate())) {
            // Advance to next full hour with at least 15-minute buffer
            LocalTime minStart = now.toLocalTime().plusMinutes(15).withMinute(0).plusHours(1);
            if (minStart.isAfter(slot)) {
                slot = minStart;
            }
        }

        DateTimeFormatter fmt = DateTimeFormatter.ofPattern("HH:mm");
        List<FlowState.ButtonOption> buttons = new ArrayList<>();
        while (!slot.isAfter(lastStart) && buttons.size() < MAX_TIME_SLOTS) {
            String id = "res_time_" + slot.format(fmt);
            String title = slot.format(fmt) + " - " + slot.plusMinutes(durationMinutes).format(fmt);
            buttons.add(createButton(id, title));
            slot = slot.plusHours(1);
        }

        if (buttons.isEmpty()) {
            log.info("No available time slots for reservation on date={}", dateStr);
            context.set("responseMessage", t("reservation_no_slots", context));
            context.set("responseButtons", List.of(createButton("action_cancel", t("btn_main_menu", context))));
            context.set("step", LaundryStep.AWAITING_MENU_CHOICE);
            goTo(context, "await_menu");
            return;
        }

        log.debug("Showing {} time slots for reservation on date={}", buttons.size(), dateStr);

        context.set("responseMessage", t("reservation_select_time_simple", context, Map.of("date", dateStr != null ? dateStr : "")));
        context.set("responseButtons", buttons);
        context.set("step", LaundryStep.AWAITING_TIME_SELECTION);
    }

    private void handleProcessTimeSelection(FlowContext context) {
        String input = context.getString("userInput");
        if ("action_cancel".equals(input)) {
            context.set("isReservation", null);
            goTo(context, "main_menu");
            return;
        }
        if (input != null && input.toLowerCase().startsWith("res_time_")) {
            context.set("reservationTime", input.substring("res_time_".length()));
            goTo(context, "reservation_confirm");
        } else {
            goTo(context, "reservation_time");
        }
    }

    private void handleShowReservationConfirm(FlowContext context) {
        String date = context.getString("reservationDate");
        String time = context.getString("reservationTime");
        LaundryBotConfig.ReservationConfig res = laundryConfig.getReservation();

        // Auto-assign a machine now that the user has selected date + time.
        // Reservations are washer-only — there is no dryer reservation flow/pricing today.
        List<MachineRecord> availableMachines;
        try {
            availableMachines = getAvailableMachines(MachineType.WASHER);
        } catch (MachineServiceUnavailableException e) {
            showMachineServiceUnavailable(context);
            return;
        }

        if (availableMachines.isEmpty()) {
            log.info("No washers available for reservation on date={}, time={}", date, time);
            context.set("responseMessage", t("no_machines", context));
            context.set("responseButtons", List.of(createButton("action_cancel", t("btn_main_menu", context))));
            context.set("step", LaundryStep.AWAITING_MENU_CHOICE);
            context.set("isReservation", null);
            goTo(context, "await_menu");
            return;
        }

        MachineRecord assignedMachine = availableMachines.getFirst();
        context.set("selectedMachineId", assignedMachine.getMachineId());
        context.set("selectedMachineName", assignedMachine.getName());

        log.info("Auto-assigned machine {} ({}) for reservation on date={}, time={}, customerPhone={}",
                assignedMachine.getMachineId(), assignedMachine.getName(), date, time,
                context.getString("customerPhone"));

        String message = t("reservation_confirm_msg", context, Map.of(
                "machine", assignedMachine.getName(),
                "date", date != null ? date : "",
                "time", time != null ? time : "",
                "duration", res.getDurationMinutes(),
                "price", res.getPrice()
        ));

        List<FlowState.ButtonOption> buttons = new ArrayList<>();
        buttons.add(createButton("confirm_reservation", t("btn_confirm_reservation", context)));
        buttons.add(createButton("action_cancel", t("btn_cancel", context)));

        context.set("responseMessage", message);
        context.set("responseButtons", buttons);
        context.set("step", LaundryStep.AWAITING_RESERVATION_CONFIRM);
    }

    private void handleProcessReservationConfirm(FlowContext context) {
        String input = getInputLower(context);
        if ("confirm_reservation".equals(input)) {
            goTo(context, "initiate_reservation");
        } else {
            context.set("isReservation", null);
            goTo(context, "main_menu");
        }
    }

    private void handleInitiateReservation(FlowContext context) {
        String customerPhone = context.getString("customerPhone");
        String machineId = context.getString("selectedMachineId");
        String machineName = context.getString("selectedMachineName");
        String reservationDate = context.getString("reservationDate");
        String reservationTime = context.getString("reservationTime");
        LaundryBotConfig.ReservationConfig res = laundryConfig.getReservation();

        String reference = laundryConfig.getBotId() + "-res-" + machineId + "-" + System.currentTimeMillis();

        Map<String, Object> metadata = new HashMap<>();
        metadata.put("machineId", machineId);
        metadata.put("machineName", machineName);
        metadata.put("reservationDate", reservationDate);
        metadata.put("reservationTime", reservationTime);
        metadata.put("duration", res.getDurationMinutes());
        metadata.put("isReservation", true);
        metadata.put("customerPhone", customerPhone);
        metadata.put("language", getLang(context).name());

        PaymentRequest request = PaymentRequest.builder()
                .botId(laundryConfig.getBotId())
                .amount(res.getPrice())
                .currency("XAF")
                .phoneNumber(customerPhone)
                .reference(reference)
                .description("Reservation for " + machineId)
                .metadata(metadata)
                .build();

        PaymentResult result = paymentGateway.initiatePayment(request);

        if (result.success()) {
            context.set("responseMessage", t("reservation_initiated", context));
            context.set("responseButtons", List.of(
                    createButton("action_my_status", t("btn_my_status", context)),
                    createButton("action_cancel", t("btn_main_menu", context))
            ));
        } else {
            String errorMessage = toUserFacingError(result.errorMessage(), getLang(context));
            context.set("responseMessage", t("payment_failed", context, Map.of("error", errorMessage)));
            List<FlowState.ButtonOption> buttons = new ArrayList<>();
            buttons.add(createButton("action_reservation", t("btn_reserve", context)));
            buttons.add(createButton("action_cancel", t("btn_main_menu", context)));
            context.set("responseButtons", buttons);
        }

        context.set("isReservation", null);
        context.set("selectedMachineId", null);
        context.set("selectedMachineName", null);
        context.set("reservationDate", null);
        context.set("reservationTime", null);
        context.set("step", LaundryStep.MAIN_MENU);
        goTo(context, "await_menu");
    }

    private void handleBusinessHoursClosed(FlowContext context, BusinessHoursService.CycleCheckResult checkResult, BusinessHoursService.BusinessHoursInfo hoursInfo) {
        String message;
        Map<String, Object> vars = Map.of(
                "openTime", hoursInfo.getOpenTime(),
                "closeTime", hoursInfo.getCloseTime(),
                "currentTime", hoursInfo.getCurrentTime()
        );

        switch (checkResult.getReason()) {
            case BEFORE_OPENING -> message = t("closed_before_opening", context, vars);
            case AFTER_CLOSING -> message = t("closed_after_closing", context, vars);
            default -> message = t("cycle_too_late_all", context, vars);
        }

        List<FlowState.ButtonOption> buttons = new ArrayList<>();
        buttons.add(createButton("action_services", t("btn_services", context)));
        buttons.add(createButton("action_cancel", t("btn_main_menu", context)));

        context.set("responseMessage", message);
        context.set("responseButtons", buttons);
        context.set("step", LaundryStep.AWAITING_MENU_CHOICE);

        // Return to the main menu input state so the next user click is captured.
        goTo(context, "await_menu");
    }

    // ========== Machine Selection ==========

    private void handleShowMachineMethodSelection(FlowContext context) {
        List<MachineRecord> availableMachines;
        try {
            availableMachines = getAvailableMachines(getSelectedMachineType(context));
        } catch (MachineServiceUnavailableException e) {
            showMachineServiceUnavailable(context);
            return;
        }
        int count = availableMachines.size();

        String message = t("machines_available", context, Map.of("count", count));

        List<FlowState.ButtonOption> buttons = new ArrayList<>();
        buttons.add(createButton("select_enter_id", t("btn_enter_id", context)));
        buttons.add(createButton("select_choose", t("btn_choose_list", context)));
        buttons.add(createButton("action_cancel", t("btn_cancel", context)));

        context.set("responseMessage", message);
        context.set("responseButtons", buttons);
        context.set("step", LaundryStep.SELECT_MACHINE_METHOD);
    }

    private void handleProcessMachineMethodSelection(FlowContext context) {
        String input = getInputLower(context);

        if ("select_enter_id".equals(input)) {
            goTo(context, "enter_machine_id");
        } else if ("select_choose".equals(input)) {
            goTo(context, "show_machine_list");
        } else {
            goTo(context, "machine_method_selection");
        }
    }

    private void handleShowEnterIdPrompt(FlowContext context) {
        String message = t("enter_machine_id", context);

        List<FlowState.ButtonOption> buttons = new ArrayList<>();
        buttons.add(createButton("action_cancel", t("btn_cancel", context)));

        context.set("responseMessage", message);
        context.set("responseButtons", buttons);
        context.set("step", LaundryStep.AWAITING_MANUAL_MACHINE_ID);
    }

    private void handleProcessManualMachineId(FlowContext context) {
        String input = context.getString("userInput");

        if (input == null || input.isBlank()) {
            goTo(context, "enter_machine_id");

            return;
        }

        String inputLower = input.toLowerCase();

        if ("select_choose".equals(inputLower)) {
            goTo(context, "show_machine_list");

            return;
        }

        if ("select_enter_id".equals(inputLower)) {
            goTo(context, "enter_machine_id");

            return;
        }

        String normalizedInput = input.toLowerCase().replace(" ", "_");
        MachineRecord foundMachine = findMachineByIdOrName(normalizedInput);

        if (foundMachine == null) {
            String message = t("machine_not_found", context, Map.of("input", input));

            List<FlowState.ButtonOption> buttons = new ArrayList<>();
            buttons.add(createButton("select_choose", t("btn_choose_list", context)));
            buttons.add(createButton("action_cancel", t("btn_cancel", context)));

            context.set("responseMessage", message);
            context.set("responseButtons", buttons);

            goTo(context, "await_manual_machine_id");

            return;
        }

        if (foundMachine.getStatus() != MachineStatus.AVAILABLE || foundMachine.getType() != getSelectedMachineType(context)) {
            String message = t("machine_unavailable", context, Map.of("machine", foundMachine.getName()));

            List<FlowState.ButtonOption> buttons = new ArrayList<>();
            buttons.add(createButton("select_enter_id", t("btn_enter_another", context)));
            buttons.add(createButton("select_choose", t("btn_choose_list", context)));
            buttons.add(createButton("action_cancel", t("btn_cancel", context)));

            context.set("responseMessage", message);
            context.set("responseButtons", buttons);

            goTo(context, "await_manual_machine_id");

            return;
        }

        context.set("selectedMachineId", foundMachine.getMachineId());
        context.set("selectedMachineName", foundMachine.getName());
        boolean isReservation = Boolean.TRUE.equals(context.get("isReservation"));
        goTo(context, isReservation ? "reservation_date" : "cycle_selection");
    }

    private void handleShowMachineList(FlowContext context) {
        List<MachineRecord> availableMachines;
        try {
            availableMachines = getAvailableMachines(getSelectedMachineType(context));
        } catch (MachineServiceUnavailableException e) {
            showMachineServiceUnavailable(context);
            return;
        }
        int totalAvailable = availableMachines.size();

        List<MachineRecord> machinesToShow = availableMachines.stream().limit(MAX_BUTTONS_DISPLAY).toList();

        StringBuilder messageBuilder = new StringBuilder(t("available_machines_title", context, Map.of("count", totalAvailable)));

        if (totalAvailable > MAX_BUTTONS_DISPLAY) {
            messageBuilder.append(t("available_machines_more", context, Map.of("count", totalAvailable)));
        }

        List<FlowState.ButtonOption> buttons = new ArrayList<>();

        for (MachineRecord machine : machinesToShow) {
            buttons.add(createButton("machine_" + machine.getMachineId(), machine.getName()));
        }

        buttons.add(createButton("action_cancel", t("btn_cancel", context)));

        context.set("responseMessage", messageBuilder.toString());
        context.set("responseButtons", buttons);
        context.set("step", LaundryStep.AWAITING_MACHINE_SELECTION);
    }

    private void handleProcessMachineListSelection(FlowContext context) {
        String input = getInputLower(context);

        if ("select_choose".equals(input)) {
            goTo(context, "show_machine_list");

            return;
        }

        if ("select_enter_id".equals(input)) {
            goTo(context, "enter_machine_id");

            return;
        }

        if (input.startsWith("machine_")) {
            String machineId = input.substring("machine_".length());
            MachineRecord machine = findMachineById(machineId);

            if (machine == null || machine.getStatus() != MachineStatus.AVAILABLE
                    || machine.getType() != getSelectedMachineType(context)) {
                String message = t("machine_just_taken", context);

                List<FlowState.ButtonOption> buttons = new ArrayList<>();
                buttons.add(createButton("select_choose", t("btn_choose_again", context)));
                buttons.add(createButton("action_cancel", t("btn_cancel", context)));

                context.set("responseMessage", message);
                context.set("responseButtons", buttons);

                goTo(context, "await_machine_selection");

                return;
            }

            context.set("selectedMachineId", machine.getMachineId());
            context.set("selectedMachineName", machine.getName());
            boolean isReservation = Boolean.TRUE.equals(context.get("isReservation"));
            goTo(context, isReservation ? "reservation_date" : "cycle_selection");

            return;
        }

        String normalizedInput = input.replace(" ", "_");
        MachineRecord typedMachine = findMachineByIdOrName(normalizedInput);

        if (typedMachine != null && typedMachine.getStatus() == MachineStatus.AVAILABLE
                && typedMachine.getType() == getSelectedMachineType(context)) {
            context.set("selectedMachineId", typedMachine.getMachineId());
            context.set("selectedMachineName", typedMachine.getName());
            boolean isReservation = Boolean.TRUE.equals(context.get("isReservation"));
            goTo(context, isReservation ? "reservation_date" : "cycle_selection");
        } else {
            goTo(context, "show_machine_list");
        }
    }

    // ========== Cycle Selection ==========

    private void handleShowCycleSelection(FlowContext context) {
        String machineName = context.getString("selectedMachineName");
        String message = t("machine_selected", context, Map.of("machine", machineName));

        CycleConfig shortCycle = laundryConfig.getShortCycle();
        CycleConfig longCycle = laundryConfig.getLongCycle();

        List<FlowState.ButtonOption> buttons = new ArrayList<>();
        buttons.add(createButton("cycle_short", t("cycle_short", context, Map.of("duration", shortCycle.getDuration(), "price", resolveShortCyclePrice(context)))));
        buttons.add(createButton("cycle_long", t("cycle_long", context, Map.of("duration", longCycle.getDuration(), "price", resolveLongCyclePrice(context)))));
        buttons.add(createButton("action_cancel", t("btn_cancel", context)));

        context.set("responseMessage", message);
        context.set("responseButtons", buttons);
        context.set("step", LaundryStep.SELECT_CYCLE);
    }

    private int resolveShortCyclePrice(FlowContext context) {
        return getSelectedMachineType(context) == MachineType.DRYER
                ? pricingClient.getDryShortPrice()
                : pricingClient.getShortCyclePrice();
    }

    private int resolveLongCyclePrice(FlowContext context) {
        return getSelectedMachineType(context) == MachineType.DRYER
                ? pricingClient.getDryLongPrice()
                : pricingClient.getLongCyclePrice();
    }

    private void handleProcessCycleSelection(FlowContext context) {
        String input = getInputLower(context);

        if ("action_cancel".equals(input)) {
            goTo(context, "main_menu");
            return;
        }

        if (!"cycle_short".equals(input) && !"cycle_long".equals(input)) {
            goTo(context, "cycle_selection");

            return;
        }

        boolean isLongCycle = "cycle_long".equals(input);
        CycleConfig selectedCycle = isLongCycle ? laundryConfig.getLongCycle() : laundryConfig.getShortCycle();
        int duration = selectedCycle.getDuration();

        BusinessHoursService.CycleCheckResult checkResult = businessHoursService.canStartCycle(duration);

        if (!checkResult.isAllowed() && checkResult.getReason() == BusinessHoursService.CycleCheckReason.CYCLE_EXCEEDS_CLOSING) {
            CycleConfig shortCycle = laundryConfig.getShortCycle();
            BusinessHoursService.CycleCheckResult shortCheck = businessHoursService.canStartCycle(shortCycle.getDuration());

            if (shortCheck.isAllowed() && isLongCycle) {
                String message = t("cycle_too_late", context, Map.of(
                        "closeTime", checkResult.getCloseTime(),
                        "duration", duration,
                        "currentTime", checkResult.getCurrentTime(),
                        "lastAllowedTime", checkResult.getLastAllowedTime()
                ));

                List<FlowState.ButtonOption> buttons = new ArrayList<>();
                buttons.add(createButton("cycle_short", t("cycle_short", context, Map.of("duration", shortCycle.getDuration(), "price", resolveShortCyclePrice(context)))));
                buttons.add(createButton("action_cancel", t("btn_main_menu", context)));

                context.set("responseMessage", message);
                context.set("responseButtons", buttons);

                goTo(context, "await_cycle");

                return;
            }

            BusinessHoursService.BusinessHoursInfo hoursInfo = businessHoursService.getBusinessHoursInfo();
            handleBusinessHoursClosed(context, checkResult, hoursInfo);

            return;
        }

        context.set("selectedCycleDuration", duration);
        context.set("selectedCyclePrice", isLongCycle ? resolveLongCyclePrice(context) : resolveShortCyclePrice(context));
        context.set("selectedCyclePulseCount", selectedCycle.getPulseCount());

        goTo(context, "initiate_payment");
    }

    // ========== Payment ==========

    private void handleInitiatePayment(FlowContext context) {
        String customerPhone = context.getString("customerPhone");
        String machineId = context.getString("selectedMachineId");
        String machineName = context.getString("selectedMachineName");
        Object durationObj = context.get("selectedCycleDuration");
        Object priceObj = context.get("selectedCyclePrice");
        Object pulseCountObj = context.get("selectedCyclePulseCount");

        int duration = durationObj instanceof Number ? ((Number) durationObj).intValue() : 30;
        int amount = priceObj instanceof Number ? ((Number) priceObj).intValue() : 1000;
        int pulseCount = pulseCountObj instanceof Number ? ((Number) pulseCountObj).intValue() : 1;

        // We'll return a single user-facing message based on whether the payment request
        // was initiated successfully.

        String reference = laundryConfig.getBotId() + "-" + machineId + "-" + System.currentTimeMillis();
        MachineType machineType = getSelectedMachineType(context);

        Map<String, Object> metadata = new HashMap<>();
        metadata.put("machineId", machineId);
        metadata.put("machineName", machineName);
        metadata.put("machineType", machineType.name());
        metadata.put("duration", duration);
        metadata.put("pulseCount", pulseCount);
        metadata.put("customerPhone", customerPhone);
        metadata.put("language", getLang(context).name());

        String description = (machineType == MachineType.DRYER ? "Dry" : "Wash") + " cycle for " + machineId;

        PaymentRequest request = PaymentRequest.builder()
                .botId(laundryConfig.getBotId())
                .amount(amount)
                .currency("XAF")
                .phoneNumber(customerPhone)
                .reference(reference)
                .description(description)
                .metadata(metadata)
                .build();

        PaymentResult result = paymentGateway.initiatePayment(request);

        if (result.success()) {
            context.set("responseMessage", t("payment_success", context));
            context.set("responseButtons", List.of(
                    createButton("action_my_status", t("btn_my_status", context)),
                    createButton("action_cancel", t("btn_main_menu", context))
            ));
            context.set("transactionId", result.transactionId());
        } else {
            String errorMessage = toUserFacingError(result.errorMessage(), getLang(context));
            context.set("responseMessage", t("payment_failed", context, Map.of("error", errorMessage)));

            List<FlowState.ButtonOption> buttons = new ArrayList<>();
            buttons.add(createButton(machineType == MachineType.DRYER ? "action_dry" : "action_wash", t("btn_try_again", context)));
            buttons.add(createButton("action_cancel", t("btn_main_menu", context)));
            context.set("responseButtons", buttons);
        }

        context.set("step", LaundryStep.MAIN_MENU);
        context.set("selectedMachineId", null);
        context.set("selectedMachineName", null);

        goTo(context, "await_menu");
    }

    // ========== Status ==========

    private void handleShowUserCycleStatus(FlowContext context) {
        String customerPhone = context.getString("customerPhone");

        // TODO: Look up active cycle for this user from transaction store
        // For now, show "no active cycle" message

        String message = t("status_none", context);

        List<FlowState.ButtonOption> buttons = new ArrayList<>();
        buttons.add(createButton("action_wash", t("btn_start_wash", context)));
        buttons.add(createButton("action_availability", t("btn_availability", context)));
        buttons.add(createButton("action_cancel", t("btn_main_menu", context)));

        context.set("responseMessage", message);
        context.set("responseButtons", buttons);
        context.set("step", LaundryStep.AWAITING_MENU_CHOICE);

        goTo(context, "await_menu");
    }

    private void handleShowMachineAvailability(FlowContext context) {
        List<MachineRecord> allMachines;
        try {
            allMachines = machineService.getMachines(laundryConfig.getBotId());
        } catch (MachineServiceUnavailableException e) {
            showMachineServiceUnavailable(context);
            return;
        }
        List<MachineRecord> availableMachines = allMachines.stream()
                .filter(m -> m.getStatus() == MachineStatus.AVAILABLE)
                .toList();
        List<MachineRecord> inUseMachines = allMachines.stream()
                .filter(m -> m.getStatus() != MachineStatus.AVAILABLE)
                .toList();

        StringBuilder message = new StringBuilder(t("availability_title", context)).append("\n\n");

        List<MachineRecord> availableToShow = availableMachines.stream().limit(MAX_BUTTONS_DISPLAY).toList();
        if (!availableToShow.isEmpty()) {
            message.append(t("availability_available", context)).append("\n");

            for (MachineRecord machine : availableToShow) {
                message.append(t("machine_available_icon", context, Map.of("name", machine.getName()))).append("\n");
            }

            if (availableMachines.size() > MAX_BUTTONS_DISPLAY) {
                message.append(t("availability_more_available", context, Map.of("count", availableMachines.size() - MAX_BUTTONS_DISPLAY))).append("\n");
            }
        } else {
            message.append(t("availability_none", context)).append("\n");
        }

        List<MachineRecord> inUseToShow = inUseMachines.stream().limit(MAX_BUTTONS_DISPLAY).toList();
        if (!inUseToShow.isEmpty()) {
            message.append("\n").append(t("availability_in_use", context)).append("\n");

            for (MachineRecord machine : inUseToShow) {
                int remainingMinutes = machine.getRemainingSeconds() != null ? machine.getRemainingSeconds() / 60 : 0;
                message.append(t("machine_in_use_icon", context, Map.of("name", machine.getName(), "minutes", remainingMinutes))).append("\n");
            }

            if (inUseMachines.size() > MAX_BUTTONS_DISPLAY) {
                message.append(t("availability_more_in_use", context, Map.of("count", inUseMachines.size() - MAX_BUTTONS_DISPLAY))).append("\n");
            }
        }

        message.append("\n").append(t("availability_total", context, Map.of(
                "available", availableMachines.size(),
                "inUse", inUseMachines.size()
        )));

        List<FlowState.ButtonOption> buttons = new ArrayList<>();
        buttons.add(createButton("action_wash", t("btn_start_wash", context)));
        buttons.add(createButton("action_cancel", t("btn_main_menu", context)));

        context.set("responseMessage", message.toString());
        context.set("responseButtons", buttons);
        context.set("step", LaundryStep.AWAITING_MENU_CHOICE);

        goTo(context, "await_menu");
    }

    // ========== Feedback ==========

    private void handleProcessFeedbackRating(FlowContext context) {
        String input = getInputLower(context);

        if (!input.startsWith("feedback_")) {
            goTo(context, "await_feedback_rating");

            return;
        }

        try {
            int rating = Integer.parseInt(input.replace("feedback_", ""));

            if (rating == 5) {
                String message = t("feedback_thanks_high", context);

                List<FlowState.ButtonOption> buttons = new ArrayList<>();
                buttons.add(createButton("action_wash", t("btn_start_wash", context)));
                buttons.add(createButton("action_cancel", t("btn_main_menu", context)));

                context.set("responseMessage", message);
                context.set("responseButtons", buttons);
                context.set("step", LaundryStep.MAIN_MENU);

                goTo(context, "await_menu");
            } else {
                String message = t("feedback_thanks_low", context);

                context.set("responseMessage", message);
                context.set("responseButtons", List.of());
                context.set("feedbackRating", rating);
                context.set("step", LaundryStep.AWAITING_FEEDBACK_COMMENT);

                goTo(context, "await_feedback_comment");
            }
        } catch (NumberFormatException e) {
            log.warn("Invalid feedback rating: {}", input);
            goTo(context, "await_feedback_rating");
        }
    }

    private void handleProcessFeedbackComment(FlowContext context) {
        String input = context.getString("userInput");
        String inputLower = input != null ? input.toLowerCase() : "";

        if ("skip".equals(inputLower) || "passer".equals(inputLower)) {
            String message = t("feedback_skipped", context);

            List<FlowState.ButtonOption> buttons = new ArrayList<>();
            buttons.add(createButton("action_wash", t("btn_start_wash", context)));
            buttons.add(createButton("action_cancel", t("btn_main_menu", context)));

            context.set("responseMessage", message);
            context.set("responseButtons", buttons);
            context.set("step", LaundryStep.MAIN_MENU);

            goTo(context, "await_menu");

            return;
        }

        if (input != null && !input.isBlank()) {
            int wordCount = input.split("\\s+").length;

            if (wordCount > 100) {
                String message = t("feedback_comment_too_long", context, Map.of("words", wordCount));

                context.set("responseMessage", message);
                context.set("responseButtons", List.of());

                goTo(context, "await_feedback_comment");

                return;
            }

            // TODO: Save feedback comment to database

            String message = t("feedback_comment_received", context);

            List<FlowState.ButtonOption> buttons = new ArrayList<>();
            buttons.add(createButton("action_wash", t("btn_start_wash", context)));
            buttons.add(createButton("action_cancel", t("btn_main_menu", context)));

            context.set("responseMessage", message);
            context.set("responseButtons", buttons);
            context.set("step", LaundryStep.MAIN_MENU);

            goTo(context, "await_menu");
        }
    }

    // ========== Helpers ==========

    private String toUserFacingError(String raw, Language lang) {
        if (raw == null || raw.isBlank()) {
            return translationService.translate("campay_err_generic", lang);
        }
        // Strip HTML responses (e.g. Cloudflare challenge pages)
        if (raw.contains("<html") || raw.contains("<!DOCTYPE")) {
            return translationService.translate("campay_err_unavailable", lang);
        }
        // Extract and map the provider error code from PaymentManagementService's error body,
        // e.g. {"error":"CAMPAY_ER102","message":"..."}
        String errorCode = extractJsonField(raw, "error");
        if (errorCode != null) {
            if (errorCode.startsWith("CAMPAY_")) {
                errorCode = errorCode.substring("CAMPAY_".length());
            }
            String translationKey = "campay_err_" + errorCode;
            String translated = translationService.translate(translationKey, lang);
            // translate() returns the key itself when not found — fall back to default
            return translationKey.equals(translated)
                    ? translationService.translate("campay_err_default", lang)
                    : translated;
        }
        // Not a recognizable JSON error body \u2014 likely a transport-level failure
        // (connection refused, timeout, etc.). Never show this raw to the user.
        log.warn("Unrecognized payment error response, showing generic message: {}", raw);
        return translationService.translate("campay_err_unavailable", lang);
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

    private String getInputLower(FlowContext context) {
        String input = context.getString("userInput");

        return input != null ? input.toLowerCase().trim() : "";
    }

    private List<MachineRecord> getAvailableMachines() {
        return machineService.getAvailableMachines(laundryConfig.getBotId());
    }

    private List<MachineRecord> getAvailableMachines(MachineType machineType) {
        return getAvailableMachines().stream()
                .filter(machine -> machine.getType() == machineType)
                .toList();
    }

    /**
     * Which machine type the current wash/dry flow is scoped to. Defaults to WASHER for
     * paths that predate the wash/dry split (e.g. reservations, or a stale session that
     * never went through handleStartCycleFlow).
     */
    private MachineType getSelectedMachineType(FlowContext context) {
        String type = context.getString("selectedMachineType");
        if ("DRYER".equals(type)) {
            return MachineType.DRYER;
        }
        return MachineType.WASHER;
    }

    private void showMachineServiceUnavailable(FlowContext context) {
        log.warn("MachineStateService unavailable, showing user-friendly message");
        context.set("responseMessage", t("machine_service_unavailable", context));
        context.set("responseButtons", List.of(
                createButton("action_cancel", t("btn_main_menu", context))
        ));
        context.set("step", LaundryStep.AWAITING_MENU_CHOICE);
        goTo(context, "await_menu");
    }

    private MachineRecord findMachineById(String machineId) {
        return machineService.getMachine(laundryConfig.getBotId(), machineId).orElse(null);
    }

    private MachineRecord findMachineByIdOrName(String input) {
        List<MachineRecord> allMachines = machineService.getMachines(laundryConfig.getBotId());

        for (MachineRecord machine : allMachines) {
            if (machine.getMachineId().equalsIgnoreCase(input)) {
                return machine;
            }

            String normalizedName = machine.getName().toLowerCase().replace(" ", "_");
            if (normalizedName.equals(input.toLowerCase())) {
                return machine;
            }
        }

        return null;
    }

    private FlowState.ButtonOption createButton(String id, String title) {
        FlowState.ButtonOption button = new FlowState.ButtonOption();
        button.setId(id);
        button.setTitle(title.length() > 20 ? title.substring(0, 20) : title);

        return button;
    }

    public boolean isResetCommand(String input) {
        return input != null && RESET_COMMANDS.contains(input.toLowerCase().trim());
    }

}
