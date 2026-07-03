package com.botmanager.bots.laundry;

import com.botmanager.core.bot.BotConfig;
import com.botmanager.core.flow.ConversationState;
import com.botmanager.core.flow.FlowDefinition;
import com.botmanager.core.flow.FlowEngine;
import com.botmanager.core.flow.FlowState;
import com.botmanager.core.flow.MessageSender;
import com.botmanager.core.flow.StateType;
import com.botmanager.core.flow.TemplateRenderer;
import com.botmanager.core.i18n.TranslationService;
import com.botmanager.core.machine.MachineRecord;
import com.botmanager.core.machine.MachineService;
import com.botmanager.core.machine.MachineStatus;
import com.botmanager.core.payment.PaymentGateway;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

/**
 * End-to-end reproduction of the "Reserve → language selection" bug.
 *
 * <p>Unlike {@link LaundryFlowPluginTest}, which drives the plugin directly, this test runs the
 * real {@link FlowEngine} and, critically, <b>serializes the {@link ConversationState} through the
 * app's ObjectMapper between every message</b> — exactly mimicking the Redis save/load cycle in
 * {@code BaseBot}. This is the only way to catch state that fails to persist between webhook calls.
 *
 * <p>The reproduced production path is: {@code hi → English → Our Services → Reserve}.
 */
@ExtendWith(MockitoExtension.class)
class ReservationFlowE2ETest {

    @Mock
    PaymentGateway paymentGateway;

    @Mock
    MachineService machineService;

    private FlowEngine flowEngine;
    private LaundryFlowPlugin plugin;
    private LaundryBotConfig config;
    private ObjectMapper objectMapper;
    private RecordingSender sender;

    /** Simulated Redis: the single serialized conversation-state blob for our test user. */
    private String persisted;

    private static final String PHONE = "+237690000000";

    @BeforeEach
    void setUp() {
        flowEngine = new FlowEngine(new TemplateRenderer());
        config = buildConfig();

        PricingClient pricingClient = new PricingClient(null, "http://localhost:8081",
                config.getShortCycle().getPrice(), config.getLongCycle().getPrice());
        plugin = new LaundryFlowPlugin(paymentGateway, machineService,
                new TranslationService(), config, pricingClient);
        plugin.setBusinessHoursService(new BusinessHoursService("00:00", "23:59", 0, "Africa/Douala"));

        // Mirrors AppConfig#objectMapper — the exact mapper BaseBot uses for Redis (de)serialization.
        objectMapper = new ObjectMapper();
        objectMapper.registerModule(new JavaTimeModule());
        objectMapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        sender = new RecordingSender();
        persisted = null;

        List<MachineRecord> available = List.of(
                MachineRecord.builder().botId("laundry").machineId("washer_01")
                        .name("Washer 1").status(MachineStatus.AVAILABLE).build());
        lenient().when(machineService.getAvailableMachines("laundry")).thenReturn(available);
    }

    @Test
    void reserveFromServicesShouldReachDateSelectionNotLanguage() throws Exception {
        send("hi");
        assertButtonIds("lang_en", "lang_fr"); // sanity: language shown

        send("lang_en");
        assertButtonIds("action_wash", "action_services", "action_my_status"); // main menu

        send("action_services");
        // services page: Start a Wash / Reserve / Main Menu
        assertThat(lastButtonIds()).contains("action_reservation");

        sender.clear();
        send("action_reservation");

        // THE BUG: this asserts we reached date selection, not a bounce back to language.
        assertThat(lastButtonIds())
                .as("Reserve must lead to date selection, not language selection")
                .anyMatch(id -> id.startsWith("res_date_"));
        assertThat(lastButtonIds())
                .as("Reserve must NOT bounce back to language selection")
                .doesNotContain("lang_en", "lang_fr");
    }

    // ---- message pump: load from "redis", step, save back to "redis" ----

    private void send(String message) throws Exception {
        ConversationState state = persisted == null
                ? new ConversationState()
                : objectMapper.readValue(persisted, ConversationState.class);
        state.setContextValue("customerPhone", PHONE);

        flowEngine.step(config, state, message, sender, plugin);

        // Simulate BaseBot#saveConversationState → RedisManager#setWithExpiry(key, state, ttl).
        persisted = objectMapper.writeValueAsString(state);
    }

    private List<String> lastButtonIds() {
        return sender.lastButtons.stream().map(FlowState.ButtonOption::getId).toList();
    }

    private void assertButtonIds(String... ids) {
        assertThat(lastButtonIds()).containsExactly(ids);
    }

    private static final class RecordingSender extends MessageSender {
        List<FlowState.ButtonOption> lastButtons = new ArrayList<>();

        void clear() {
            lastButtons = new ArrayList<>();
        }

        @Override
        public void sendText(String to, String body) {
            lastButtons = new ArrayList<>();
        }

        @Override
        public void sendButtons(String to, String body, List<FlowState.ButtonOption> buttons) {
            lastButtons = new ArrayList<>(buttons);
        }

        @Override
        public void sendList(String to, ListMessage message) {
            lastButtons = new ArrayList<>();
        }
    }

    // ---- config with the subset of laundry_flow states on the reservation path ----

    private LaundryBotConfig buildConfig() {
        LaundryBotConfig c = new LaundryBotConfig();
        c.setBotId("laundry");
        c.setDefaultFlowId("laundry_flow");
        c.setShortCycle(new CycleConfig(30, 1000, 1));
        c.setLongCycle(new CycleConfig(60, 2000, 2));

        LaundryBotConfig.BusinessHoursConfig hours = new LaundryBotConfig.BusinessHoursConfig();
        hours.setOpenTime("00:00");
        hours.setCloseTime("23:59");
        hours.setClosingBufferMinutes(0);
        hours.setTimezone("Africa/Douala");
        c.setBusinessHours(hours);

        LaundryBotConfig.FeaturesConfig features = new LaundryBotConfig.FeaturesConfig();
        features.setWashFlowEnabled(true);
        features.setReservationEnabled(true);
        c.setFeatures(features);

        LaundryBotConfig.ReservationConfig reservation = new LaundryBotConfig.ReservationConfig();
        reservation.setPrice(500);
        reservation.setDurationMinutes(60);
        c.setReservation(reservation);

        Map<String, FlowState> states = new LinkedHashMap<>();
        states.put("language_selection", action("language_selection", "language.show", "await_language"));
        states.put("await_language", input("await_language", "userInput", "process_language"));
        states.put("process_language", action("process_language", "language.process", null));
        states.put("main_menu", action("main_menu", "menu.show", "await_menu"));
        states.put("await_menu", input("await_menu", "userInput", "process_menu"));
        states.put("process_menu", action("process_menu", "menu.process", null));
        states.put("show_services", action("show_services", "services.show", null));
        states.put("reservation_date", action("reservation_date", "reservation.showDate", "await_reservation_date"));
        states.put("await_reservation_date", input("await_reservation_date", "userInput", "process_reservation_date"));
        states.put("process_reservation_date", action("process_reservation_date", "reservation.processDate", null));

        FlowDefinition flow = new FlowDefinition();
        flow.setId("laundry_flow");
        flow.setTriggers(List.of("hi", "hello", "reset", "cancel", "stop", "start"));
        flow.setStartState("language_selection");
        flow.setStates(states);

        Map<String, FlowDefinition> flows = new HashMap<>();
        flows.put("laundry_flow", flow);
        c.setFlows(flows);

        return c;
    }

    private FlowState action(String id, String actionName, String next) {
        FlowState s = new FlowState();
        s.setId(id);
        s.setType(StateType.ACTION);
        s.setAction(actionName);
        s.setNext(next);
        return s;
    }

    private FlowState input(String id, String saveAs, String next) {
        FlowState s = new FlowState();
        s.setId(id);
        s.setType(StateType.INPUT);
        s.setSaveAs(saveAs);
        s.setNext(next);
        return s;
    }
}
