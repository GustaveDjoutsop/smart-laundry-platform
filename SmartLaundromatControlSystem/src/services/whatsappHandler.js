const whatsappService = require('../services/whatsappService');
const { requestPayment } = require('../services/campayService');
const { getSession, setSession, clearSession } = require('../utils/stateManager');

const handleIncomingMessage = async (from, messageBody, buttonId) => {
    let session = await getSession(from);
    // Prefer button clicks over text input for clear user intent.
    const input = buttonId || messageBody?.toLowerCase().trim();

    // Global reset command
    if (['hi', 'hello', 'start', 'reset'].includes(input)) {
        session = { step: 'MAIN_MENU' };
        await setSession(from, session);
    }

    // --- STATE MACHINE ---
    switch (session.step) {
        case 'MAIN_MENU':
            await whatsappService.sendButtons(from, "Welcome to Smart Laundry! 🧺\nWhat would you like to do?", [
                { id: "action_wash", title: "Start a Wash" },
                { id: "action_status", title: "Check Status" }
            ]);
            await setSession(from, { step: 'AWAITING_MENU_CHOICE' });
            break;

        case 'AWAITING_MENU_CHOICE':
            if (input === 'action_wash') {
                // In a real app, you would fetch available machines from the DB here.
                await whatsappService.sendButtons(from, "Please select an available machine:", [
                    { id: "washer_01", title: "Washer 1 (Available)" },
                    { id: "washer_02", title: "Washer 2 (Available)" }
                ]);
                await setSession(from, { step: 'SELECT_CYCLE' });
            } else if (input === 'action_status') {
                // This would also be dynamic based on DB state.
                await whatsappService.sendMessage(from, "🟢 Washer 1: Available\n🔴 Washer 2: In Use (10 mins remaining)");
                await clearSession(from); // Reset after providing status.
            }
            break;

        case 'SELECT_CYCLE':
            // The input is the machineId from the button click (e.g., "washer_01")
            await setSession(from, { step: 'CONFIRM_PAY', machineId: input });
            await whatsappService.sendButtons(from, `You selected ${input}. Please choose your cycle:`, [
                { id: "cycle_short", title: "30 Mins (1000 XAF)" },
                { id: "cycle_long", title: "60 Mins (2000 XAF)" }
            ]);
            break;

        case 'CONFIRM_PAY':
            const isLongCycle = input === 'cycle_long';
            const amount = isLongCycle ? 2 : 1;
            const pulseCount = isLongCycle ? 2 : 1;
            const { machineId } = session;

            if (!machineId) {
                await whatsappService.sendMessage(from, "Something went wrong. Please type 'start' to begin again.");
                await clearSession(from);
                break;
            }

            await whatsappService.sendMessage(from, `⏳ Initiating payment for ${amount} XAF... Please check your phone to approve.`);

            // Delegate payment request AND database logging to the campayService
            const result = await requestPayment(from, amount, `Wash cycle for ${machineId}`, machineId, pulseCount);

            if (result.success) {
                await whatsappService.sendMessage(from, "✅ Prompt sent! Please enter your PIN on your phone. The machine will start automatically once payment is confirmed.");
            } else {
                await whatsappService.sendMessage(from, "❌ Sorry, the payment request failed. Please type 'start' to try again.");
            }

            await clearSession(from); // End of conversation flow.
            break;

        default:
            await whatsappService.sendMessage(from, "Sorry, I didn't understand that. Type 'start' to see the main menu.");
            await clearSession(from);
            break;
    }
};

module.exports = { handleIncomingMessage };