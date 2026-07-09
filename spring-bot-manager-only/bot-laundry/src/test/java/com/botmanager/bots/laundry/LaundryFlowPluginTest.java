package com.botmanager.bots.laundry;

import com.botmanager.core.flow.ConversationState;
import com.botmanager.core.flow.FlowContext;
import com.botmanager.core.flow.FlowState;
import com.botmanager.core.i18n.Language;
import com.botmanager.core.i18n.TranslationService;
import com.botmanager.core.machine.MachineRecord;
import com.botmanager.core.machine.MachineService;
import com.botmanager.core.machine.MachineServiceUnavailableException;
import com.botmanager.core.machine.MachineStatus;
import com.botmanager.core.machine.MachineType;
import com.botmanager.core.payment.PaymentGateway;
import com.botmanager.core.payment.PaymentResult;
import com.botmanager.core.payment.PaymentStatus;
import com.botmanager.core.redis.RedisManager;
import com.botmanager.core.whatsapp.WhatsAppClient;
import com.botmanager.core.whatsapp.WhatsAppClientFactory;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestTemplate;

import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class LaundryFlowPluginTest {

    @Mock
    PaymentGateway paymentGateway;

    @Mock
    MachineService machineService;

    @Mock
    WhatsAppClientFactory whatsAppClientFactory;

    TranslationService translationService;

    LaundryBotConfig laundryConfig;

    LaundryFlowPlugin plugin;

    FeedbackService feedbackService;

    @BeforeEach
    void setUp() {
        translationService = new TranslationService();
        laundryConfig = createTestConfig();
        // PricingClient with no RestTemplate — falls back to config prices immediately
        PricingClient pricingClient = new PricingClient(null, "http://localhost:8081",
                laundryConfig.getShortCycle().getPrice(), laundryConfig.getLongCycle().getPrice(),
                laundryConfig.getReservation().getPrice());
        // TransactionClient with no RestTemplate — always returns null (no active cycle)
        TransactionClient transactionClient = new TransactionClient(null, "http://localhost:8081");
        // Real FeedbackService backed by RedisManager's in-memory fallback (no Redis in unit tests —
        // RedisManager.redisAvailable defaults to false when @PostConstruct init() never runs).
        // JavaTimeModule is required to (de)serialize FeedbackRecord.submittedAt (an Instant).
        ObjectMapper feedbackObjectMapper = new ObjectMapper().registerModule(new com.fasterxml.jackson.datatype.jsr310.JavaTimeModule());
        feedbackService = new FeedbackService(new RedisManager(null, feedbackObjectMapper),
                translationService, whatsAppClientFactory, feedbackObjectMapper);
        plugin = new LaundryFlowPlugin(paymentGateway, machineService, translationService, laundryConfig,
                pricingClient, transactionClient, feedbackService);
        // Inject a business-hours service that always allows cycles so tests
        // are not sensitive to the wall-clock time when CI happens to run.
        plugin.setBusinessHoursService(new BusinessHoursService("00:00", "23:59", 0, "UTC") {
            @Override
            public CycleCheckResult canStartCycle(int d) {
                return CycleCheckResult.builder().allowed(true)
                        .reason(CycleCheckReason.OK).build();
            }
        });
    }

    private LaundryBotConfig createTestConfig() {
        LaundryBotConfig config = new LaundryBotConfig();
        config.setBotId("test-laundry");
        config.setShortCycle(new CycleConfig(30, 1000, 1));
        config.setLongCycle(new CycleConfig(60, 2000, 2));

        // Span the full day so canStartCycle() doesn't flip to "closed" depending on
        // the wall-clock time the test happens to run at (it was flaking near 22:00
        // Africa/Douala, since the 07:00-22:00 + 15min-buffer window excludes the
        // last ~45 minutes before close for a 30-minute cycle).
        LaundryBotConfig.BusinessHoursConfig hours = new LaundryBotConfig.BusinessHoursConfig();
        hours.setOpenTime("00:00");
        hours.setCloseTime("23:59");
        hours.setClosingBufferMinutes(0);
        hours.setTimezone("Africa/Douala");
        config.setBusinessHours(hours);

        LaundryBotConfig.FeaturesConfig features = new LaundryBotConfig.FeaturesConfig();
        features.setWashFlowEnabled(true);
        features.setReservationEnabled(true);
        config.setFeatures(features);

        LaundryBotConfig.ReservationConfig reservation = new LaundryBotConfig.ReservationConfig();
        reservation.setPrice(500);
        reservation.setDurationMinutes(60);
        config.setReservation(reservation);

        return config;
    }

    private FlowContext createContext() {
        ConversationState state = new ConversationState();
        state.setContextValue("language", "en");
        state.setContextValue("customerPhone", "+237690000000");
        return new FlowContext(state);
    }

    private FlowContext createContextFr() {
        ConversationState state = new ConversationState();
        state.setContextValue("language", "fr");
        state.setContextValue("customerPhone", "+237690000000");
        return new FlowContext(state);
    }

    @SuppressWarnings("unchecked")
    private List<FlowState.ButtonOption> getButtons(FlowContext context) {
        return (List<FlowState.ButtonOption>) context.get("responseButtons");
    }

    private com.botmanager.core.flow.MessageSender.ListMessage getResponseList(FlowContext context) {
        return (com.botmanager.core.flow.MessageSender.ListMessage) context.get("responseList");
    }

    private MachineRecord createMachine(String id, String name, MachineStatus status) {
        return createMachine(id, name, status, MachineType.WASHER);
    }

    private MachineRecord createMachine(String id, String name, MachineStatus status, MachineType type) {
        return MachineRecord.builder()
                .botId("test-laundry")
                .machineId(id)
                .name(name)
                .status(status)
                .type(type)
                .build();
    }

    // ========== Language Selection ==========

    @Nested
    class LanguageSelection {

        @Test
        void shouldShowLanguageSelectionWithTwoButtons() {
            // given
            FlowContext context = createContext();

            // when
            plugin.handleAction("language.show", Map.of(), context);

            // then
            assertThat(context.getString("responseMessage")).isNotBlank();
            assertThat(getButtons(context)).hasSize(2);
            assertThat(context.getString("step")).isEqualTo(LaundryStep.AWAITING_LANGUAGE_CHOICE);
        }

        @ParameterizedTest
        @ValueSource(strings = {"lang_en", "english", "en"})
        void shouldSetEnglishLanguageWhenEnglishSelected(String input) {
            // given
            FlowContext context = createContext();
            context.set("userInput", input);

            // when
            plugin.handleAction("language.process", Map.of(), context);

            // then
            assertThat(context.getString("language")).isEqualTo("en");
            assertThat(context.getString("step")).isEqualTo(LaundryStep.MAIN_MENU);
            assertThat(context.hasGotoTarget()).isTrue();
        }

        @ParameterizedTest
        @ValueSource(strings = {"lang_fr", "french", "fr", "francais"})
        void shouldSetFrenchLanguageWhenFrenchSelected(String input) {
            // given
            FlowContext context = createContext();
            context.set("userInput", input);

            // when
            plugin.handleAction("language.process", Map.of(), context);

            // then
            assertThat(context.getString("language")).isEqualTo("fr");
            assertThat(context.getString("step")).isEqualTo(LaundryStep.MAIN_MENU);
        }

        @Test
        void shouldRepeatLanguageSelectionWhenInvalidInput() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "gibberish");

            // when
            plugin.handleAction("language.process", Map.of(), context);

            // then
            assertThat(context.consumeGotoTarget()).isEqualTo("language_selection");
        }

        @ParameterizedTest
        @ValueSource(strings = {"action_reservation", "action_wash", "action_services", "action_cancel"})
        void shouldRecoverToMainMenuWhenActionButtonPressedAtLanguageScreen(String actionInput) {
            // Regression guard: if Redis loses conversation state, the bot restarts at language_selection.
            // The user may still have a stale WhatsApp session showing action buttons. Pressing any of
            // them should NOT loop them in language selection — it should default to EN and go to main_menu.
            FlowContext context = createContext();
            context.set("language", null);
            context.set("userInput", actionInput);

            plugin.handleAction("language.process", Map.of(), context);

            assertThat(context.consumeGotoTarget()).isEqualTo("main_menu");
            assertThat(context.getString("language")).isEqualTo("en");
        }

        @Test
        void shouldPreserveExistingLanguageWhenRecoveringFromLostState() {
            // If the user already had their language set in context (partial state survival), keep it.
            FlowContext context = createContext();
            context.set("language", "fr");
            context.set("userInput", "action_reservation");

            plugin.handleAction("language.process", Map.of(), context);

            assertThat(context.consumeGotoTarget()).isEqualTo("main_menu");
            assertThat(context.getString("language")).isEqualTo("fr");
        }
    }

    // ========== Main Menu ==========

    @Nested
    class MainMenu {

        @Test
        void shouldShowMainMenuWithFourListRows() {
            // given
            FlowContext context = createContext();

            // when
            plugin.handleAction("menu.show", Map.of(), context);

            // then
            com.botmanager.core.flow.MessageSender.ListMessage listMessage = getResponseList(context);
            assertThat(listMessage).isNotNull();
            assertThat(listMessage.body()).isNotBlank();
            assertThat(listMessage.sections()).hasSize(1);
            assertThat(listMessage.sections().getFirst().rows()).hasSize(4);
            assertThat(listMessage.sections().getFirst().rows())
                    .extracting(com.botmanager.core.flow.MessageSender.ListRow::id)
                    .containsExactly("action_wash", "action_dry", "action_services", "action_my_status");
            assertThat(context.getString("step")).isEqualTo(LaundryStep.AWAITING_MENU_CHOICE);
        }

        @Test
        void shouldGoToServicesWhenActionServicesSelected() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "action_services");

            // when
            plugin.handleAction("menu.process", Map.of(), context);

            // then
            assertThat(context.consumeGotoTarget()).isEqualTo("show_services");
        }

        @Test
        void shouldGoToUserStatusWhenMyStatusSelected() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "action_my_status");

            // when
            plugin.handleAction("menu.process", Map.of(), context);

            // then
            assertThat(context.consumeGotoTarget()).isEqualTo("show_user_status");
        }

        @Test
        void shouldGoToMainMenuWhenCancelSelected() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "action_cancel");

            // when
            plugin.handleAction("menu.process", Map.of(), context);

            // then
            assertThat(context.consumeGotoTarget()).isEqualTo("main_menu");
        }

        @Test
        void shouldGoToMainMenuWhenUnknownInput() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "random_stuff");

            // when
            plugin.handleAction("menu.process", Map.of(), context);

            // then
            assertThat(context.consumeGotoTarget()).isEqualTo("main_menu");
        }

        @Test
        void shouldGoToAvailabilityWhenAvailabilitySelected() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "action_availability");

            // when
            plugin.handleAction("menu.process", Map.of(), context);

            // then
            assertThat(context.consumeGotoTarget()).isEqualTo("show_availability");
        }
    }

    // ========== Services ==========

    @Nested
    class Services {

        @Test
        void shouldShowServicesWithReservationRowWhenReservationEnabled() {
            // given
            FlowContext context = createContext();
            laundryConfig.getFeatures().setReservationEnabled(true);

            // when
            plugin.handleAction("services.show", Map.of(), context);

            // then
            com.botmanager.core.flow.MessageSender.ListMessage listMessage = getResponseList(context);
            assertThat(listMessage.body()).contains("Services");
            assertThat(listMessage.sections().getFirst().rows())
                    .extracting(com.botmanager.core.flow.MessageSender.ListRow::id)
                    .containsExactly("action_wash", "action_dry", "action_reservation", "action_cancel");
            assertThat(context.getString("step")).isEqualTo(LaundryStep.AWAITING_MENU_CHOICE);
        }

        @Test
        void shouldShowServicesWithAvailabilityRowWhenReservationDisabled() {
            // given
            FlowContext context = createContext();
            laundryConfig.getFeatures().setReservationEnabled(false);

            // when
            plugin.handleAction("services.show", Map.of(), context);

            // then
            com.botmanager.core.flow.MessageSender.ListMessage listMessage = getResponseList(context);
            assertThat(listMessage.sections().getFirst().rows())
                    .extracting(com.botmanager.core.flow.MessageSender.ListRow::id)
                    .containsExactly("action_wash", "action_dry", "action_availability", "action_cancel");
        }
    }

    // ========== Wash Flow ==========

    @Nested
    class WashFlow {

        @Test
        void shouldAutoPickMachineAndGoToCycleSelectionWhenMachinesAvailable() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "action_wash");
            MachineRecord machine = createMachine("washer_01", "Washer 1", MachineStatus.AVAILABLE);
            when(machineService.getAvailableMachines("test-laundry")).thenReturn(List.of(machine));

            // when
            plugin.handleAction("menu.process", Map.of(), context);

            // then
            assertThat(context.getString("selectedMachineId")).isEqualTo("washer_01");
            assertThat(context.getString("selectedMachineName")).isEqualTo("Washer 1");
            assertThat(context.consumeGotoTarget()).isEqualTo("cycle_selection");
        }

        @Test
        void shouldShowNoMachinesMessageWhenNoneAvailable() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "action_wash");
            when(machineService.getAvailableMachines("test-laundry")).thenReturn(Collections.emptyList());

            // when
            plugin.handleAction("menu.process", Map.of(), context);

            // then
            assertThat(context.getString("responseMessage")).isNotBlank();
            assertThat(context.getString("step")).isEqualTo(LaundryStep.AWAITING_MENU_CHOICE);
        }

        @Test
        void shouldShowDisabledMessageWhenWashFlowDisabled() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "action_wash");
            laundryConfig.getFeatures().setWashFlowEnabled(false);

            // when
            plugin.handleAction("menu.process", Map.of(), context);

            // then
            assertThat(context.getString("responseMessage")).isNotBlank();
            assertThat(context.getString("step")).isEqualTo(LaundryStep.AWAITING_MENU_CHOICE);
        }

        @Test
        void shouldShowMachineServiceUnavailableWhenServiceThrows() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "action_wash");
            when(machineService.getAvailableMachines("test-laundry"))
                    .thenThrow(new MachineServiceUnavailableException("Service down"));

            // when
            plugin.handleAction("menu.process", Map.of(), context);

            // then
            assertThat(context.getString("responseMessage")).isNotBlank();
            assertThat(context.getString("step")).isEqualTo(LaundryStep.AWAITING_MENU_CHOICE);
        }

        @Test
        void shouldNeverAutoPickADryerWhenMixedMachinesAvailable() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "action_wash");
            MachineRecord dryer = createMachine("dryer_01", "Dryer 1", MachineStatus.AVAILABLE, MachineType.DRYER);
            MachineRecord washer = createMachine("washer_01", "Washer 1", MachineStatus.AVAILABLE, MachineType.WASHER);
            when(machineService.getAvailableMachines("test-laundry")).thenReturn(List.of(dryer, washer));

            // when
            plugin.handleAction("menu.process", Map.of(), context);

            // then
            assertThat(context.getString("selectedMachineId")).isEqualTo("washer_01");
            assertThat(context.getString("selectedMachineType")).isEqualTo("WASHER");
            assertThat(context.consumeGotoTarget()).isEqualTo("cycle_selection");
        }

        @Test
        void shouldShowNoMachinesWhenOnlyDryersAvailable() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "action_wash");
            MachineRecord dryer = createMachine("dryer_01", "Dryer 1", MachineStatus.AVAILABLE, MachineType.DRYER);
            when(machineService.getAvailableMachines("test-laundry")).thenReturn(List.of(dryer));

            // when
            plugin.handleAction("menu.process", Map.of(), context);

            // then
            assertThat(context.getString("responseMessage")).isNotBlank();
            assertThat(context.getString("selectedMachineId")).isNull();
            assertThat(context.getString("step")).isEqualTo(LaundryStep.AWAITING_MENU_CHOICE);
        }
    }

    // ========== Dry Flow ==========

    @Nested
    class DryFlow {

        @Test
        void shouldAutoPickDryerAndGoToCycleSelectionWhenMachinesAvailable() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "action_dry");
            MachineRecord machine = createMachine("dryer_01", "Dryer 1", MachineStatus.AVAILABLE, MachineType.DRYER);
            when(machineService.getAvailableMachines("test-laundry")).thenReturn(List.of(machine));

            // when
            plugin.handleAction("menu.process", Map.of(), context);

            // then
            assertThat(context.getString("selectedMachineId")).isEqualTo("dryer_01");
            assertThat(context.getString("selectedMachineName")).isEqualTo("Dryer 1");
            assertThat(context.getString("selectedMachineType")).isEqualTo("DRYER");
            assertThat(context.consumeGotoTarget()).isEqualTo("cycle_selection");
        }

        @Test
        void shouldNeverAutoPickAWasherWhenMixedMachinesAvailable() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "action_dry");
            MachineRecord washer = createMachine("washer_01", "Washer 1", MachineStatus.AVAILABLE, MachineType.WASHER);
            MachineRecord dryer = createMachine("dryer_01", "Dryer 1", MachineStatus.AVAILABLE, MachineType.DRYER);
            when(machineService.getAvailableMachines("test-laundry")).thenReturn(List.of(washer, dryer));

            // when
            plugin.handleAction("menu.process", Map.of(), context);

            // then
            assertThat(context.getString("selectedMachineId")).isEqualTo("dryer_01");
            assertThat(context.consumeGotoTarget()).isEqualTo("cycle_selection");
        }

        @Test
        void shouldShowNoMachinesWhenOnlyWashersAvailable() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "action_dry");
            MachineRecord washer = createMachine("washer_01", "Washer 1", MachineStatus.AVAILABLE, MachineType.WASHER);
            when(machineService.getAvailableMachines("test-laundry")).thenReturn(List.of(washer));

            // when
            plugin.handleAction("menu.process", Map.of(), context);

            // then
            assertThat(context.getString("selectedMachineId")).isNull();
            assertThat(context.getString("step")).isEqualTo(LaundryStep.AWAITING_MENU_CHOICE);
        }

        @Test
        void shouldUseDryPricingInCycleSelection() {
            // given
            FlowContext context = createContext();
            context.set("selectedMachineName", "Dryer 1");
            context.set("selectedMachineType", "DRYER");

            // when
            plugin.handleAction("cycle.show", Map.of(), context);

            // then — falls back to config defaults since PricingClient has no RestTemplate in tests
            assertThat(context.getString("responseMessage")).contains("Dryer 1");
            assertThat(getButtons(context)).hasSize(3);
        }

        @Test
        void shouldRecordDryerAsSelectedMachineTypeThroughPayment() {
            // given
            FlowContext context = createContext();
            context.set("selectedMachineType", "DRYER");
            context.set("selectedMachineId", "dryer_01");
            context.set("userInput", "cycle_long");

            // when
            plugin.handleAction("cycle.process", Map.of(), context);

            // then
            assertThat(context.get("selectedCyclePrice")).isEqualTo(2000);
            assertThat(context.consumeGotoTarget()).isEqualTo("initiate_payment");
        }
    }

    // ========== Machine Selection ==========

    @Nested
    class MachineSelection {

        @Test
        void shouldShowMachineMethodSelectionWithCount() {
            // given
            FlowContext context = createContext();
            MachineRecord machine = createMachine("w1", "W1", MachineStatus.AVAILABLE);
            when(machineService.getAvailableMachines("test-laundry")).thenReturn(List.of(machine));

            // when
            plugin.handleAction("machines.showMethodSelection", Map.of(), context);

            // then
            assertThat(context.getString("responseMessage")).contains("1");
            assertThat(getButtons(context)).hasSize(3);
            assertThat(context.getString("step")).isEqualTo(LaundryStep.SELECT_MACHINE_METHOD);
        }

        @Test
        void shouldShowMachineServiceUnavailableOnMethodSelection() {
            // given
            FlowContext context = createContext();
            when(machineService.getAvailableMachines("test-laundry"))
                    .thenThrow(new MachineServiceUnavailableException("down"));

            // when
            plugin.handleAction("machines.showMethodSelection", Map.of(), context);

            // then
            assertThat(context.getString("step")).isEqualTo(LaundryStep.AWAITING_MENU_CHOICE);
        }

        @Test
        void shouldGoToEnterIdWhenSelectEnterId() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "select_enter_id");

            // when
            plugin.handleAction("machines.processMethodSelection", Map.of(), context);

            // then
            assertThat(context.consumeGotoTarget()).isEqualTo("enter_machine_id");
        }

        @Test
        void shouldGoToShowListWhenSelectChoose() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "select_choose");

            // when
            plugin.handleAction("machines.processMethodSelection", Map.of(), context);

            // then
            assertThat(context.consumeGotoTarget()).isEqualTo("show_machine_list");
        }

        @Test
        void shouldRepeatMethodSelectionOnInvalidInput() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "something");

            // when
            plugin.handleAction("machines.processMethodSelection", Map.of(), context);

            // then
            assertThat(context.consumeGotoTarget()).isEqualTo("machine_method_selection");
        }

        @Test
        void shouldShowEnterIdPrompt() {
            // given
            FlowContext context = createContext();

            // when
            plugin.handleAction("machines.showEnterIdPrompt", Map.of(), context);

            // then
            assertThat(context.getString("responseMessage")).isNotBlank();
            assertThat(context.getString("step")).isEqualTo(LaundryStep.AWAITING_MANUAL_MACHINE_ID);
        }

        @Test
        void shouldRepeatEnterIdWhenBlankInput() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "  ");

            // when
            plugin.handleAction("machines.processManualId", Map.of(), context);

            // then
            assertThat(context.consumeGotoTarget()).isEqualTo("enter_machine_id");
        }

        @Test
        void shouldRepeatEnterIdWhenNullInput() {
            // given
            FlowContext context = createContext();
            context.set("userInput", null);

            // when
            plugin.handleAction("machines.processManualId", Map.of(), context);

            // then
            assertThat(context.consumeGotoTarget()).isEqualTo("enter_machine_id");
        }

        @Test
        void shouldGoToMachineListWhenSelectChooseFromManualId() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "select_choose");

            // when
            plugin.handleAction("machines.processManualId", Map.of(), context);

            // then
            assertThat(context.consumeGotoTarget()).isEqualTo("show_machine_list");
        }

        @Test
        void shouldGoToEnterIdWhenSelectEnterIdFromManualId() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "select_enter_id");

            // when
            plugin.handleAction("machines.processManualId", Map.of(), context);

            // then
            assertThat(context.consumeGotoTarget()).isEqualTo("enter_machine_id");
        }

        @Test
        void shouldSelectMachineByIdWhenFound() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "washer_01");
            MachineRecord machine = createMachine("washer_01", "Washer 1", MachineStatus.AVAILABLE);
            when(machineService.getMachines("test-laundry")).thenReturn(List.of(machine));

            // when
            plugin.handleAction("machines.processManualId", Map.of(), context);

            // then
            assertThat(context.getString("selectedMachineId")).isEqualTo("washer_01");
            assertThat(context.getString("selectedMachineName")).isEqualTo("Washer 1");
            assertThat(context.consumeGotoTarget()).isEqualTo("cycle_selection");
        }

        @Test
        void shouldGoToReservationDateWhenMachineSelectedInReservationFlow() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "washer_01");
            context.set("isReservation", true);
            MachineRecord machine = createMachine("washer_01", "Washer 1", MachineStatus.AVAILABLE);
            when(machineService.getMachines("test-laundry")).thenReturn(List.of(machine));

            // when
            plugin.handleAction("machines.processManualId", Map.of(), context);

            // then
            assertThat(context.consumeGotoTarget()).isEqualTo("reservation_date");
        }

        @Test
        void shouldShowNotFoundWhenMachineDoesNotExist() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "nonexistent");
            when(machineService.getMachines("test-laundry")).thenReturn(Collections.emptyList());

            // when
            plugin.handleAction("machines.processManualId", Map.of(), context);

            // then
            assertThat(context.getString("responseMessage")).contains("nonexistent");
        }

        @Test
        void shouldShowUnavailableWhenMachineInUse() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "washer_01");
            MachineRecord machine = createMachine("washer_01", "Washer 1", MachineStatus.IN_USE);
            when(machineService.getMachines("test-laundry")).thenReturn(List.of(machine));

            // when
            plugin.handleAction("machines.processManualId", Map.of(), context);

            // then
            assertThat(context.getString("responseMessage")).contains("Washer 1");
        }

        @Test
        void shouldShowMachineListWithButtons() {
            // given
            FlowContext context = createContext();
            MachineRecord m1 = createMachine("w1", "Washer 1", MachineStatus.AVAILABLE);
            MachineRecord m2 = createMachine("w2", "Washer 2", MachineStatus.AVAILABLE);
            when(machineService.getAvailableMachines("test-laundry")).thenReturn(List.of(m1, m2));

            // when
            plugin.handleAction("machines.showList", Map.of(), context);

            // then
            assertThat(context.getString("responseMessage")).isNotBlank();
            // 2 machines + cancel button
            assertThat(getButtons(context)).hasSize(3);
            assertThat(context.getString("step")).isEqualTo(LaundryStep.AWAITING_MACHINE_SELECTION);
        }

        @Test
        void shouldShowMoreMessageWhenMachinesExceedLimit() {
            // given
            FlowContext context = createContext();
            MachineRecord m1 = createMachine("w1", "Washer 1", MachineStatus.AVAILABLE);
            MachineRecord m2 = createMachine("w2", "Washer 2", MachineStatus.AVAILABLE);
            MachineRecord m3 = createMachine("w3", "Washer 3", MachineStatus.AVAILABLE);
            when(machineService.getAvailableMachines("test-laundry")).thenReturn(List.of(m1, m2, m3));

            // when
            plugin.handleAction("machines.showList", Map.of(), context);

            // then
            assertThat(context.getString("responseMessage")).contains("3");
            // Only 2 machine buttons + cancel
            assertThat(getButtons(context)).hasSize(3);
        }

        @Test
        void shouldShowMachineServiceUnavailableOnListAction() {
            // given
            FlowContext context = createContext();
            when(machineService.getAvailableMachines("test-laundry"))
                    .thenThrow(new MachineServiceUnavailableException("down"));

            // when
            plugin.handleAction("machines.showList", Map.of(), context);

            // then
            assertThat(context.getString("step")).isEqualTo(LaundryStep.AWAITING_MENU_CHOICE);
        }

        @Test
        void shouldSelectMachineFromListByButtonId() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "machine_w1");
            MachineRecord machine = createMachine("w1", "Washer 1", MachineStatus.AVAILABLE);
            when(machineService.getMachine("test-laundry", "w1")).thenReturn(Optional.of(machine));

            // when
            plugin.handleAction("machines.processListSelection", Map.of(), context);

            // then
            assertThat(context.getString("selectedMachineId")).isEqualTo("w1");
            assertThat(context.consumeGotoTarget()).isEqualTo("cycle_selection");
        }

        @Test
        void shouldShowMachineTakenWhenSelectedMachineUnavailable() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "machine_w1");
            MachineRecord machine = createMachine("w1", "Washer 1", MachineStatus.IN_USE);
            when(machineService.getMachine("test-laundry", "w1")).thenReturn(Optional.of(machine));

            // when
            plugin.handleAction("machines.processListSelection", Map.of(), context);

            // then
            assertThat(context.getString("responseMessage")).isNotBlank();
        }

        @Test
        void shouldShowMachineTakenWhenSelectedMachineNotFound() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "machine_w1");
            when(machineService.getMachine("test-laundry", "w1")).thenReturn(Optional.empty());

            // when
            plugin.handleAction("machines.processListSelection", Map.of(), context);

            // then
            assertThat(context.getString("responseMessage")).isNotBlank();
        }

        @Test
        void shouldGoToShowListWhenSelectChooseFromListSelection() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "select_choose");

            // when
            plugin.handleAction("machines.processListSelection", Map.of(), context);

            // then
            assertThat(context.consumeGotoTarget()).isEqualTo("show_machine_list");
        }

        @Test
        void shouldGoToEnterIdFromListSelection() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "select_enter_id");

            // when
            plugin.handleAction("machines.processListSelection", Map.of(), context);

            // then
            assertThat(context.consumeGotoTarget()).isEqualTo("enter_machine_id");
        }

        @Test
        void shouldSelectMachineByTypedNameFromListSelection() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "Washer 1");
            MachineRecord machine = createMachine("w1", "Washer 1", MachineStatus.AVAILABLE);
            when(machineService.getMachines("test-laundry")).thenReturn(List.of(machine));

            // when
            plugin.handleAction("machines.processListSelection", Map.of(), context);

            // then
            assertThat(context.getString("selectedMachineId")).isEqualTo("w1");
            assertThat(context.consumeGotoTarget()).isEqualTo("cycle_selection");
        }

        @Test
        void shouldGoBackToListWhenTypedNameNotFound() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "Unknown Machine");
            when(machineService.getMachines("test-laundry")).thenReturn(Collections.emptyList());

            // when
            plugin.handleAction("machines.processListSelection", Map.of(), context);

            // then
            assertThat(context.consumeGotoTarget()).isEqualTo("show_machine_list");
        }

        @Test
        void shouldGoToReservationDateFromListSelectionWhenInReservationFlow() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "machine_w1");
            context.set("isReservation", true);
            MachineRecord machine = createMachine("w1", "Washer 1", MachineStatus.AVAILABLE);
            when(machineService.getMachine("test-laundry", "w1")).thenReturn(Optional.of(machine));

            // when
            plugin.handleAction("machines.processListSelection", Map.of(), context);

            // then
            assertThat(context.consumeGotoTarget()).isEqualTo("reservation_date");
        }
    }

    // ========== Cycle Selection ==========

    @Nested
    class CycleSelection {

        @Test
        void shouldShowCycleSelectionWithMachineName() {
            // given
            FlowContext context = createContext();
            context.set("selectedMachineName", "Washer 1");

            // when
            plugin.handleAction("cycle.show", Map.of(), context);

            // then
            assertThat(context.getString("responseMessage")).contains("Washer 1");
            assertThat(getButtons(context)).hasSize(3);
            assertThat(context.getString("step")).isEqualTo(LaundryStep.SELECT_CYCLE);
        }

        @Test
        void shouldGoToPaymentWhenShortCycleSelected() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "cycle_short");

            // when
            plugin.handleAction("cycle.process", Map.of(), context);

            // then
            assertThat(context.get("selectedCycleDuration")).isEqualTo(30);
            assertThat(context.get("selectedCyclePrice")).isEqualTo(1000);
            assertThat(context.get("selectedCyclePulseCount")).isEqualTo(1);
            assertThat(context.consumeGotoTarget()).isEqualTo("initiate_payment");
        }

        @Test
        void shouldGoToPaymentWhenLongCycleSelected() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "cycle_long");

            // when
            plugin.handleAction("cycle.process", Map.of(), context);

            // then
            assertThat(context.get("selectedCycleDuration")).isEqualTo(60);
            assertThat(context.get("selectedCyclePrice")).isEqualTo(2000);
            assertThat(context.get("selectedCyclePulseCount")).isEqualTo(2);
            assertThat(context.consumeGotoTarget()).isEqualTo("initiate_payment");
        }

        @Test
        void shouldRepeatCycleSelectionOnInvalidInput() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "invalid");

            // when
            plugin.handleAction("cycle.process", Map.of(), context);

            // then
            assertThat(context.consumeGotoTarget()).isEqualTo("cycle_selection");
        }
    }

    // ========== Payment ==========

    @Nested
    class Payment {

        @Test
        void shouldShowSuccessMessageWhenPaymentSucceeds() {
            // given
            FlowContext context = createContext();
            context.set("selectedMachineId", "w1");
            context.set("selectedMachineName", "Washer 1");
            context.set("selectedCycleDuration", 30);
            context.set("selectedCyclePrice", 1000);
            context.set("selectedCyclePulseCount", 1);

            PaymentResult result = PaymentResult.builder()
                    .success(true)
                    .transactionId("txn123")
                    .build();
            when(paymentGateway.initiatePayment(any())).thenReturn(result);

            // when
            plugin.handleAction("payment.initiate", Map.of(), context);

            // then
            assertThat(context.getString("responseMessage")).isNotBlank();
            assertThat(context.getString("transactionId")).isEqualTo("txn123");
            assertThat(context.getString("step")).isEqualTo(LaundryStep.MAIN_MENU);
            assertThat(context.get("selectedMachineId")).isNull();
        }

        @Test
        void shouldShowFailureMessageWhenPaymentFails() {
            // given
            FlowContext context = createContext();
            context.set("selectedMachineId", "w1");
            context.set("selectedMachineName", "Washer 1");
            context.set("selectedCycleDuration", 30);
            context.set("selectedCyclePrice", 1000);
            context.set("selectedCyclePulseCount", 1);

            PaymentResult result = PaymentResult.builder()
                    .success(false)
                    .errorMessage("Insufficient funds")
                    .build();
            when(paymentGateway.initiatePayment(any())).thenReturn(result);

            // when
            plugin.handleAction("payment.initiate", Map.of(), context);

            // then
            assertThat(context.getString("responseMessage")).isNotBlank();
            assertThat(context.getString("step")).isEqualTo(LaundryStep.MAIN_MENU);
        }

        @Test
        void shouldUseDefaultValuesWhenCycleContextMissing() {
            // given
            FlowContext context = createContext();
            context.set("selectedMachineId", "w1");
            context.set("selectedMachineName", "Washer 1");
            // Not setting cycle duration/price/pulse - should use defaults

            PaymentResult result = PaymentResult.builder()
                    .success(true)
                    .transactionId("txn456")
                    .build();
            when(paymentGateway.initiatePayment(any())).thenReturn(result);

            // when
            plugin.handleAction("payment.initiate", Map.of(), context);

            // then
            verify(paymentGateway).initiatePayment(any());
            assertThat(context.getString("step")).isEqualTo(LaundryStep.MAIN_MENU);
        }

        @Test
        void shouldHandleHtmlPaymentError() {
            // given
            FlowContext context = createContext();
            context.set("selectedMachineId", "w1");
            context.set("selectedMachineName", "Washer 1");
            context.set("selectedCycleDuration", 30);
            context.set("selectedCyclePrice", 1000);
            context.set("selectedCyclePulseCount", 1);

            PaymentResult result = PaymentResult.builder()
                    .success(false)
                    .errorMessage("<html><body>Cloudflare</body></html>")
                    .build();
            when(paymentGateway.initiatePayment(any())).thenReturn(result);

            // when
            plugin.handleAction("payment.initiate", Map.of(), context);

            // then
            assertThat(context.getString("responseMessage")).isNotBlank();
        }

        @Test
        void shouldHandleCamPayErrorCode() {
            // given
            FlowContext context = createContext();
            context.set("selectedMachineId", "w1");
            context.set("selectedMachineName", "Washer 1");
            context.set("selectedCycleDuration", 30);
            context.set("selectedCyclePrice", 1000);
            context.set("selectedCyclePulseCount", 1);

            PaymentResult result = PaymentResult.builder()
                    .success(false)
                    .errorMessage("{\"error_code\":\"ER104\"}")
                    .build();
            when(paymentGateway.initiatePayment(any())).thenReturn(result);

            // when
            plugin.handleAction("payment.initiate", Map.of(), context);

            // then
            assertThat(context.getString("responseMessage")).isNotBlank();
        }

        @Test
        void shouldHandleNullPaymentError() {
            // given
            FlowContext context = createContext();
            context.set("selectedMachineId", "w1");
            context.set("selectedMachineName", "Washer 1");
            context.set("selectedCycleDuration", 30);
            context.set("selectedCyclePrice", 1000);
            context.set("selectedCyclePulseCount", 1);

            PaymentResult result = PaymentResult.builder()
                    .success(false)
                    .errorMessage(null)
                    .build();
            when(paymentGateway.initiatePayment(any())).thenReturn(result);

            // when
            plugin.handleAction("payment.initiate", Map.of(), context);

            // then
            assertThat(context.getString("responseMessage")).isNotBlank();
        }
    }

    // ========== Reservation ==========

    @Nested
    class Reservation {

        @Test
        void shouldStartReservationFlowWhenEnabled() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "action_reservation");

            // when
            plugin.handleAction("menu.process", Map.of(), context);

            // then
            assertThat(context.get("isReservation")).isEqualTo(true);
            assertThat(context.consumeGotoTarget()).isEqualTo("reservation_date");
        }

        @Test
        void shouldShowDisabledMessageWhenReservationDisabled() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "action_reservation");
            laundryConfig.getFeatures().setReservationEnabled(false);

            // when
            plugin.handleAction("menu.process", Map.of(), context);

            // then
            assertThat(context.getString("responseMessage")).isNotBlank();
            assertThat(context.getString("step")).isEqualTo(LaundryStep.AWAITING_MENU_CHOICE);
        }

        @Test
        void shouldShowDateSelectionWithTwoDays() {
            // given
            FlowContext context = createContext();

            // when
            plugin.handleAction("reservation.showDate", Map.of(), context);

            // then
            assertThat(context.getString("responseMessage")).isNotBlank();
            // 2 date buttons + cancel
            assertThat(getButtons(context)).hasSize(3);
            assertThat(context.getString("step")).isEqualTo(LaundryStep.AWAITING_DATE_SELECTION);
        }

        @Test
        void shouldProcessDateSelectionWithValidInput() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "res_date_2026-06-10");

            // when
            plugin.handleAction("reservation.processDate", Map.of(), context);

            // then
            assertThat(context.getString("reservationDate")).isEqualTo("2026-06-10");
            assertThat(context.consumeGotoTarget()).isEqualTo("reservation_time");
        }

        @Test
        void shouldRepeatDateSelectionWithInvalidInput() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "invalid");

            // when
            plugin.handleAction("reservation.processDate", Map.of(), context);

            // then
            assertThat(context.consumeGotoTarget()).isEqualTo("reservation_date");
        }

        @Test
        void shouldShowTimeSelectionSlots() {
            // given
            FlowContext context = createContext();
            // Use tomorrow to get full slots
            context.set("reservationDate", "2026-06-11");

            // when
            plugin.handleAction("reservation.showTime", Map.of(), context);

            // then
            assertThat(context.getString("responseMessage")).isNotBlank();
            assertThat(getButtons(context)).isNotEmpty();
            assertThat(context.getString("step")).isEqualTo(LaundryStep.AWAITING_TIME_SELECTION);
        }

        @Test
        void shouldProcessTimeSelectionWithValidInput() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "res_time_10:00");

            // when
            plugin.handleAction("reservation.processTime", Map.of(), context);

            // then
            assertThat(context.getString("reservationTime")).isEqualTo("10:00");
            assertThat(context.consumeGotoTarget()).isEqualTo("reservation_confirm");
        }

        @Test
        void shouldRepeatTimeSelectionWithInvalidInput() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "invalid");

            // when
            plugin.handleAction("reservation.processTime", Map.of(), context);

            // then
            assertThat(context.consumeGotoTarget()).isEqualTo("reservation_time");
        }

        @Test
        void shouldShowReservationConfirmWithMachineAssigned() {
            // given
            FlowContext context = createContext();
            context.set("reservationDate", "2026-06-11");
            context.set("reservationTime", "10:00");
            MachineRecord machine = createMachine("w1", "Washer 1", MachineStatus.AVAILABLE);
            when(machineService.getAvailableMachines("test-laundry")).thenReturn(List.of(machine));

            // when
            plugin.handleAction("reservation.confirm", Map.of(), context);

            // then
            assertThat(context.getString("selectedMachineId")).isEqualTo("w1");
            assertThat(context.getString("responseMessage")).contains("Washer 1");
            assertThat(getButtons(context)).hasSize(2);
            assertThat(context.getString("step")).isEqualTo(LaundryStep.AWAITING_RESERVATION_CONFIRM);
        }

        @Test
        void shouldShowNoMachinesOnReservationConfirmWhenNoneAvailable() {
            // given
            FlowContext context = createContext();
            context.set("reservationDate", "2026-06-11");
            context.set("reservationTime", "10:00");
            when(machineService.getAvailableMachines("test-laundry")).thenReturn(Collections.emptyList());

            // when
            plugin.handleAction("reservation.confirm", Map.of(), context);

            // then
            assertThat(context.getString("responseMessage")).isNotBlank();
            assertThat(context.get("isReservation")).isNull();
        }

        @Test
        void shouldNeverAssignADryerForReservationWhenMixedMachinesAvailable() {
            // given
            FlowContext context = createContext();
            context.set("reservationDate", "2026-06-11");
            context.set("reservationTime", "10:00");
            MachineRecord dryer = createMachine("dryer_01", "Dryer 1", MachineStatus.AVAILABLE, MachineType.DRYER);
            MachineRecord washer = createMachine("washer_01", "Washer 1", MachineStatus.AVAILABLE, MachineType.WASHER);
            when(machineService.getAvailableMachines("test-laundry")).thenReturn(List.of(dryer, washer));

            // when
            plugin.handleAction("reservation.confirm", Map.of(), context);

            // then
            assertThat(context.getString("selectedMachineId")).isEqualTo("washer_01");
            assertThat(context.getString("step")).isEqualTo(LaundryStep.AWAITING_RESERVATION_CONFIRM);
        }

        @Test
        void shouldShowNoMachinesOnReservationConfirmWhenOnlyDryersAvailable() {
            // given
            FlowContext context = createContext();
            context.set("reservationDate", "2026-06-11");
            context.set("reservationTime", "10:00");
            MachineRecord dryer = createMachine("dryer_01", "Dryer 1", MachineStatus.AVAILABLE, MachineType.DRYER);
            when(machineService.getAvailableMachines("test-laundry")).thenReturn(List.of(dryer));

            // when
            plugin.handleAction("reservation.confirm", Map.of(), context);

            // then
            assertThat(context.getString("responseMessage")).isNotBlank();
            assertThat(context.getString("selectedMachineId")).isNull();
        }

        @Test
        void shouldShowMachineServiceUnavailableOnReservationConfirm() {
            // given
            FlowContext context = createContext();
            context.set("reservationDate", "2026-06-11");
            context.set("reservationTime", "10:00");
            when(machineService.getAvailableMachines("test-laundry"))
                    .thenThrow(new MachineServiceUnavailableException("down"));

            // when
            plugin.handleAction("reservation.confirm", Map.of(), context);

            // then
            assertThat(context.getString("step")).isEqualTo(LaundryStep.AWAITING_MENU_CHOICE);
        }

        @Test
        void shouldGoToInitiateReservationOnConfirm() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "confirm_reservation");

            // when
            plugin.handleAction("reservation.processConfirm", Map.of(), context);

            // then
            assertThat(context.consumeGotoTarget()).isEqualTo("initiate_reservation");
        }

        @Test
        void shouldGoToMainMenuOnReservationCancel() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "action_cancel");

            // when
            plugin.handleAction("reservation.processConfirm", Map.of(), context);

            // then
            assertThat(context.get("isReservation")).isNull();
            assertThat(context.consumeGotoTarget()).isEqualTo("main_menu");
        }

        @Test
        void shouldInitiateReservationPaymentSuccessfully() {
            // given
            FlowContext context = createContext();
            context.set("selectedMachineId", "w1");
            context.set("selectedMachineName", "Washer 1");
            context.set("reservationDate", "2026-06-11");
            context.set("reservationTime", "10:00");

            PaymentResult result = PaymentResult.builder()
                    .success(true)
                    .transactionId("res-txn-1")
                    .build();
            when(paymentGateway.initiatePayment(any())).thenReturn(result);

            // when
            plugin.handleAction("reservation.initiate", Map.of(), context);

            // then
            assertThat(context.getString("responseMessage")).isNotBlank();
            assertThat(context.get("isReservation")).isNull();
            assertThat(context.get("selectedMachineId")).isNull();
            assertThat(context.get("reservationDate")).isNull();
            assertThat(context.getString("step")).isEqualTo(LaundryStep.MAIN_MENU);
        }

        @Test
        void shouldHandleReservationPaymentFailure() {
            // given
            FlowContext context = createContext();
            context.set("selectedMachineId", "w1");
            context.set("selectedMachineName", "Washer 1");
            context.set("reservationDate", "2026-06-11");
            context.set("reservationTime", "10:00");

            PaymentResult result = PaymentResult.builder()
                    .success(false)
                    .errorMessage("Payment declined")
                    .build();
            when(paymentGateway.initiatePayment(any())).thenReturn(result);

            // when
            plugin.handleAction("reservation.initiate", Map.of(), context);

            // then
            assertThat(context.getString("responseMessage")).isNotBlank();
            assertThat(context.getString("step")).isEqualTo(LaundryStep.MAIN_MENU);
        }
    }

    // ========== Status ==========

    @Nested
    class Status {

        @Test
        void shouldShowNoActiveCycleStatus() {
            // given
            FlowContext context = createContext();

            // when
            plugin.handleAction("status.showUserCycle", Map.of(), context);

            // then
            assertThat(context.getString("responseMessage")).isNotBlank();
            assertThat(getButtons(context)).hasSize(3);
            assertThat(context.getString("step")).isEqualTo(LaundryStep.AWAITING_MENU_CHOICE);
        }

        @Test
        @SuppressWarnings("unchecked")
        void shouldShowAllActiveCyclesWhenMultipleRunning() {
            // given — customer has paid for two machines that are both still running
            RestTemplate restTemplate = mock(RestTemplate.class);
            when(restTemplate.getForEntity(anyString(), eq(Map.class), any(Map.class)))
                    .thenReturn(ResponseEntity.ok(Map.of(
                            "hasCycle", true,
                            "cycles", List.of(
                                    Map.of("machineId", "washer_01", "amount", 1000),
                                    Map.of("machineId", "dryer_02", "amount", 500)
                            )
                    )));
            TransactionClient client = new TransactionClient(restTemplate, "http://localhost:8081");
            PricingClient pricingClient = new PricingClient(null, "http://localhost:8081",
                    laundryConfig.getShortCycle().getPrice(), laundryConfig.getLongCycle().getPrice(),
                    laundryConfig.getReservation().getPrice());
            LaundryFlowPlugin pluginWithCycles = new LaundryFlowPlugin(
                    paymentGateway, machineService, translationService, laundryConfig, pricingClient, client,
                    feedbackService);
            FlowContext context = createContext();

            // when
            pluginWithCycles.handleAction("status.showUserCycle", Map.of(), context);

            // then — both machines are mentioned, not just the most recent one
            String message = context.getString("responseMessage");
            assertThat(message).contains("washer_01").contains("dryer_02");
        }

        @Test
        void shouldShowMachineAvailabilityWithBothAvailableAndInUse() {
            // given
            FlowContext context = createContext();
            MachineRecord available = createMachine("w1", "Washer 1", MachineStatus.AVAILABLE);
            MachineRecord inUse = MachineRecord.builder()
                    .botId("test-laundry")
                    .machineId("w2")
                    .name("Washer 2")
                    .status(MachineStatus.IN_USE)
                    .remainingSeconds(1800)
                    .build();
            when(machineService.getMachines("test-laundry")).thenReturn(List.of(available, inUse));

            // when
            plugin.handleAction("status.showAvailability", Map.of(), context);

            // then
            String message = context.getString("responseMessage");
            assertThat(message).contains("Washer 1");
            assertThat(message).contains("Washer 2");
            assertThat(context.getString("step")).isEqualTo(LaundryStep.AWAITING_MENU_CHOICE);
        }

        @Test
        void shouldShowNoAvailableMachinesInAvailability() {
            // given
            FlowContext context = createContext();
            MachineRecord inUse = MachineRecord.builder()
                    .botId("test-laundry")
                    .machineId("w1")
                    .name("Washer 1")
                    .status(MachineStatus.IN_USE)
                    .remainingSeconds(600)
                    .build();
            when(machineService.getMachines("test-laundry")).thenReturn(List.of(inUse));

            // when
            plugin.handleAction("status.showAvailability", Map.of(), context);

            // then
            assertThat(context.getString("responseMessage")).isNotBlank();
        }

        @Test
        void shouldShowAllAvailableWithNoInUseMachines() {
            // given
            FlowContext context = createContext();
            MachineRecord m1 = createMachine("w1", "Washer 1", MachineStatus.AVAILABLE);
            when(machineService.getMachines("test-laundry")).thenReturn(List.of(m1));

            // when
            plugin.handleAction("status.showAvailability", Map.of(), context);

            // then
            assertThat(context.getString("responseMessage")).contains("Washer 1");
        }

        @Test
        void shouldHandleInUseMachineWithNullRemainingSeconds() {
            // given
            FlowContext context = createContext();
            MachineRecord inUse = MachineRecord.builder()
                    .botId("test-laundry")
                    .machineId("w1")
                    .name("Washer 1")
                    .status(MachineStatus.IN_USE)
                    .remainingSeconds(null)
                    .build();
            when(machineService.getMachines("test-laundry")).thenReturn(List.of(inUse));

            // when
            plugin.handleAction("status.showAvailability", Map.of(), context);

            // then
            assertThat(context.getString("responseMessage")).isNotBlank();
        }

        @Test
        void shouldShowMoreAvailableMessageWhenExceedsLimit() {
            // given
            FlowContext context = createContext();
            MachineRecord m1 = createMachine("w1", "Washer 1", MachineStatus.AVAILABLE);
            MachineRecord m2 = createMachine("w2", "Washer 2", MachineStatus.AVAILABLE);
            MachineRecord m3 = createMachine("w3", "Washer 3", MachineStatus.AVAILABLE);
            when(machineService.getMachines("test-laundry")).thenReturn(List.of(m1, m2, m3));

            // when
            plugin.handleAction("status.showAvailability", Map.of(), context);

            // then
            assertThat(context.getString("responseMessage")).contains("1");
        }

        @Test
        void shouldShowMoreInUseMessageWhenExceedsLimit() {
            // given
            FlowContext context = createContext();
            MachineRecord m1 = MachineRecord.builder().botId("test-laundry").machineId("w1").name("Washer 1").status(MachineStatus.IN_USE).remainingSeconds(300).build();
            MachineRecord m2 = MachineRecord.builder().botId("test-laundry").machineId("w2").name("Washer 2").status(MachineStatus.IN_USE).remainingSeconds(600).build();
            MachineRecord m3 = MachineRecord.builder().botId("test-laundry").machineId("w3").name("Washer 3").status(MachineStatus.IN_USE).remainingSeconds(900).build();
            when(machineService.getMachines("test-laundry")).thenReturn(List.of(m1, m2, m3));

            // when
            plugin.handleAction("status.showAvailability", Map.of(), context);

            // then
            assertThat(context.getString("responseMessage")).contains("1");
        }

        @Test
        void shouldShowMachineServiceUnavailableOnAvailability() {
            // given
            FlowContext context = createContext();
            when(machineService.getMachines("test-laundry"))
                    .thenThrow(new MachineServiceUnavailableException("down"));

            // when
            plugin.handleAction("status.showAvailability", Map.of(), context);

            // then
            assertThat(context.getString("step")).isEqualTo(LaundryStep.AWAITING_MENU_CHOICE);
        }
    }

    // ========== Feedback ==========

    @Nested
    class Feedback {

        @Test
        void shouldShowHighRatingThankYouWhenRating5() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "feedback_5");

            // when
            plugin.handleAction("feedback.processRating", Map.of(), context);

            // then
            assertThat(context.getString("responseMessage")).isNotBlank();
            assertThat(context.getString("step")).isEqualTo(LaundryStep.MAIN_MENU);
        }

        @ParameterizedTest
        @ValueSource(strings = {"feedback_1", "feedback_2", "feedback_3", "feedback_4"})
        void shouldAskForCommentWhenRatingBelow5(String input) {
            // given
            FlowContext context = createContext();
            context.set("userInput", input);

            // when
            plugin.handleAction("feedback.processRating", Map.of(), context);

            // then
            assertThat(context.getString("responseMessage")).isNotBlank();
            assertThat(context.getString("step")).isEqualTo(LaundryStep.AWAITING_FEEDBACK_COMMENT);
            assertThat(context.getString("feedbackId")).isNotBlank();
        }

        @Test
        void shouldRepeatRatingWhenInvalidFeedbackInput() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "not_feedback");

            // when
            plugin.handleAction("feedback.processRating", Map.of(), context);

            // then
            assertThat(context.consumeGotoTarget()).isEqualTo("await_feedback_rating");
        }

        @Test
        void shouldRepeatRatingWhenNonNumericFeedback() {
            // given
            FlowContext context = createContext();
            context.set("userInput", "feedback_abc");

            // when
            plugin.handleAction("feedback.processRating", Map.of(), context);

            // then
            assertThat(context.consumeGotoTarget()).isEqualTo("await_feedback_rating");
        }

        @ParameterizedTest
        @ValueSource(strings = {"skip", "passer"})
        void shouldSkipCommentWhenSkipEntered(String input) {
            // given — go through the rating step first so a real feedbackId exists
            FlowContext context = ratedContext("feedback_3");
            context.set("userInput", input);

            // when
            plugin.handleAction("feedback.processComment", Map.of(), context);

            // then
            assertThat(context.getString("responseMessage")).isNotBlank();
            assertThat(context.getString("step")).isEqualTo(LaundryStep.MAIN_MENU);
        }

        @Test
        void shouldAcceptValidFeedbackComment() {
            // given
            FlowContext context = ratedContext("feedback_3");
            context.set("userInput", "The machine was noisy");

            // when
            plugin.handleAction("feedback.processComment", Map.of(), context);

            // then
            assertThat(context.getString("responseMessage")).isNotBlank();
            assertThat(context.getString("step")).isEqualTo(LaundryStep.MAIN_MENU);
        }

        @Test
        void shouldRejectTooLongComment() {
            // given
            FlowContext context = ratedContext("feedback_3");
            StringBuilder longComment = new StringBuilder();
            for (int i = 0; i < 110; i++) {
                longComment.append("word ");
            }
            context.set("userInput", longComment.toString().trim());

            // when
            plugin.handleAction("feedback.processComment", Map.of(), context);

            // then
            assertThat(context.getString("responseMessage")).contains("110");
        }

        @Test
        void shouldHandleNullCommentInput() {
            // given
            FlowContext context = ratedContext("feedback_3");
            context.set("userInput", null);

            // when
            plugin.handleAction("feedback.processComment", Map.of(), context);

            // then - should not throw, behavior is to skip gracefully (skip path)
            // With null input, inputLower becomes "", which is not "skip" or "passer",
            // and input is null so the else-if branch is skipped too — no exception.
        }

        @Test
        void shouldAlertStaffOnLowRatingImmediately() {
            // given — rating 1 is "low"; the staff alert fires as soon as the rating is
            // submitted, not after the (optional) comment step, so a customer who never
            // replies again still triggers a timely alert.
            laundryConfig.setStaffAlertPhone("+237699999999");
            WhatsAppClient staffClient = mock(WhatsAppClient.class);
            when(whatsAppClientFactory.getClient(laundryConfig.getBotId(), laundryConfig.getPhoneNumberId()))
                    .thenReturn(staffClient);

            FlowContext context = createContext();
            context.set("userInput", "feedback_1");

            // when
            plugin.handleAction("feedback.processRating", Map.of(), context);

            // then
            verify(staffClient).sendText(eq("+237699999999"), anyString());
        }

        @Test
        void shouldNotAlertStaffOnHighRating() {
            // given — rating 5 never enters the comment step at all, so no alert either way
            laundryConfig.setStaffAlertPhone("+237699999999");

            FlowContext context = createContext();
            context.set("userInput", "feedback_5");

            // when
            plugin.handleAction("feedback.processRating", Map.of(), context);

            // then
            verifyNoInteractions(whatsAppClientFactory);
        }

        private FlowContext ratedContext(String ratingInput) {
            FlowContext context = createContext();
            context.set("userInput", ratingInput);
            plugin.handleAction("feedback.processRating", Map.of(), context);
            return context;
        }
    }

    // ========== Reset Command ==========

    @Nested
    class ResetCommand {

        @ParameterizedTest
        @ValueSource(strings = {"hi", "hello", "reset", "cancel", "stop", "action_cancel", "start",
                "Hi", "HELLO", "Reset", "CANCEL", "  start  "})
        void shouldRecognizeResetCommands(String input) {
            // given / when / then
            assertThat(plugin.isResetCommand(input)).isTrue();
        }

        @ParameterizedTest
        @ValueSource(strings = {"wash", "menu", "help", "action_wash"})
        void shouldNotRecognizeNonResetCommands(String input) {
            // given / when / then
            assertThat(plugin.isResetCommand(input)).isFalse();
        }

        @Test
        void shouldReturnFalseForNullInput() {
            // given / when / then
            assertThat(plugin.isResetCommand(null)).isFalse();
        }
    }

    // ========== Unknown Action ==========

    @Test
    void shouldHandleUnknownActionGracefully() {
        // given
        FlowContext context = createContext();

        // when
        plugin.handleAction("nonexistent.action", Map.of(), context);

        // then - should not throw, just log warning
        assertThat(context.getString("responseMessage")).isNull();
    }

    // ========== French Language ==========

    @Test
    void shouldShowMainMenuInFrench() {
        // given
        FlowContext context = createContextFr();

        // when
        plugin.handleAction("menu.show", Map.of(), context);

        // then
        assertThat(getResponseList(context).body()).contains("Bienvenue");
    }
}
