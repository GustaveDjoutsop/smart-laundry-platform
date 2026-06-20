const mongoose = require('mongoose');
const whatsappService = require('../services/whatsappService');
const { requestPayment } = require('../services/paymentService');
const { processFeedbackRating, processFeedbackComment, skipFeedbackComment } = require('../services/feedbackService');
const { getSession, setSession, clearSession } = require('../utils/stateManager');
const { t, DEFAULT_LANGUAGE } = require('../utils/i18n');
const config = require('../config/env');
const Transaction = require('../models/Transaction');
const { canStartCycle, getBusinessHoursInfo } = require('../utils/businessHours');

// Helper to check if MongoDB is actually connected
const isDbConnected = () => mongoose.connection.readyState === 1;

// Helper function to format machine name
const formatMachineName = (machineId) => {
    return machineId.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
};

// Timeout for pending payments (in minutes) - after this, machine becomes available again
const PENDING_PAYMENT_TIMEOUT_MINUTES = 5;

// Helper function to get all machines with their status from DB
const getMachinesStatus = async () => {
    const allMachines = config.MACHINES.AVAILABLE_MACHINES;
    const machinesStatus = [];

    for (const machineId of allMachines) {
        let activeTransaction = null;
        let pendingTransaction = null;

        if (isDbConnected()) {
            // Check if machine has an active cycle (IN_PROGRESS and not expired)
            activeTransaction = await Transaction.findOne({
                machineId,
                cycleStatus: 'IN_PROGRESS',
                cycleEndsAt: { $gt: new Date() }
            }).sort({ cycleStartedAt: -1 });

            // If no active cycle, check for recent PENDING payments (prevents race condition)
            if (!activeTransaction) {
                const pendingTimeout = new Date();
                pendingTimeout.setMinutes(pendingTimeout.getMinutes() - PENDING_PAYMENT_TIMEOUT_MINUTES);

                pendingTransaction = await Transaction.findOne({
                    machineId,
                    status: 'PENDING',
                    createdAt: { $gt: pendingTimeout } // Only consider recent pending payments
                }).sort({ createdAt: -1 });
            }
        }

        if (activeTransaction) {
            // Machine has an active cycle
            const remainingMs = activeTransaction.cycleEndsAt - new Date();
            const remainingMins = Math.ceil(remainingMs / (1000 * 60));
            machinesStatus.push({
                id: machineId,
                name: formatMachineName(machineId),
                available: false,
                remainingMinutes: remainingMins
            });
        } else if (pendingTransaction) {
            // Machine has a pending payment - mark as unavailable with 0 remaining
            machinesStatus.push({
                id: machineId,
                name: formatMachineName(machineId),
                available: false,
                remainingMinutes: 0,
                pendingPayment: true
            });
        } else {
            machinesStatus.push({
                id: machineId,
                name: formatMachineName(machineId),
                available: true,
                remainingMinutes: 0
            });
        }
    }

    return machinesStatus;
};

// Helper function to get available machines
const getAvailableMachines = async () => {
    const allMachines = await getMachinesStatus();
    return allMachines.filter(m => m.available);
};

// Helper function to get in-use machines
const getInUseMachines = async () => {
    const allMachines = await getMachinesStatus();
    return allMachines.filter(m => !m.available);
};

// Helper function to check if a specific machine is available
const isMachineAvailable = async (machineId) => {
    const allMachines = await getMachinesStatus();
    const machine = allMachines.find(m => m.id.toLowerCase() === machineId.toLowerCase());
    return machine?.available || false;
};

// Helper function to find machine by ID (case-insensitive)
const findMachine = (machineId) => {
    const allMachines = config.MACHINES.AVAILABLE_MACHINES;
    return allMachines.find(id => id.toLowerCase() === machineId.toLowerCase());
};

// Helper function to get user's active wash cycle
const getUserActiveCycle = async (phoneNumber) => {
    if (!isDbConnected()) return null;

    // Find user's most recent active cycle
    const activeCycle = await Transaction.findOne({
        phoneNumber,
        status: 'SUCCESSFUL',
        cycleStatus: 'IN_PROGRESS',
        cycleEndsAt: { $gt: new Date() }
    }).sort({ cycleStartedAt: -1 });

    return activeCycle;
};

// Helper to get language from session
const getLang = (session) => session.lang || DEFAULT_LANGUAGE;

const handleIncomingMessage = async (from, messageBody, buttonId) => {
    let session = await getSession(from);
    const lang = getLang(session);

    // Prefer button clicks over text input for clear user intent.
    const input = buttonId || messageBody?.trim();
    const inputLower = input?.toLowerCase();

    // Global reset/cancel command - available at any step
    // But preserve language preference when resetting
    if (['hi', 'hello', 'reset', 'cancel', 'stop', 'action_cancel'].includes(inputLower)) {
        // If user has a language set, go to main menu; otherwise go to language selection
        if (session.lang) {
            session = { step: 'MAIN_MENU', lang: session.lang };
        } else {
            session = { step: 'LANGUAGE_SELECTION' };
        }
        await setSession(from, session);
    }

    // --- QR CODE DEEP LINK DETECTION ---
    // Handles "START washer_01" messages from QR code scans
    // Skips menu and goes directly to cycle selection
    if (inputLower?.startsWith('start ')) {
        const machineIdFromQR = input.split(' ')[1]?.trim();
        if (machineIdFromQR) {
            const qrMachine = findMachine(machineIdFromQR);
            const userLang = session.lang || DEFAULT_LANGUAGE;

            if (!qrMachine) {
                // Machine not found - show error and menu
                await whatsappService.sendButtons(from, t('machine_not_found', userLang, { input: machineIdFromQR }), [
                    { id: "action_wash", title: t('btn_start_wash', userLang) },
                    { id: "action_cancel", title: t('btn_main_menu', userLang) }
                ]);
                await setSession(from, { step: 'AWAITING_MENU_CHOICE', lang: userLang });
                return;
            }

            if (!(await isMachineAvailable(qrMachine))) {
                // Machine unavailable - show error and options
                await whatsappService.sendButtons(from, t('machine_unavailable', userLang, { machine: formatMachineName(qrMachine) }), [
                    { id: "action_wash", title: t('btn_start_wash', userLang) },
                    { id: "action_availability", title: t('btn_availability', userLang) },
                    { id: "action_cancel", title: t('btn_main_menu', userLang) }
                ]);
                await setSession(from, { step: 'AWAITING_MENU_CHOICE', lang: userLang });
                return;
            }

            // Machine found and available - jump directly to cycle selection!
            await setSession(from, { step: 'SELECT_CYCLE', machineId: qrMachine, lang: userLang });
            const qrMachineName = formatMachineName(qrMachine);
            await whatsappService.sendButtons(from, t('machine_selected', userLang, { machine: qrMachineName }), [
                { id: "cycle_short", title: t('cycle_short', userLang, { duration: config.CYCLES.SHORT.duration, price: config.PRICING.SHORT_CYCLE }) },
                { id: "cycle_long", title: t('cycle_long', userLang, { duration: config.CYCLES.LONG.duration, price: config.PRICING.LONG_CYCLE }) },
                { id: "action_cancel", title: t('btn_cancel', userLang) }
            ]);
            return;
        }
    }

    // --- STATE MACHINE ---
    switch (session.step) {
        case 'LANGUAGE_SELECTION':
            // First interaction - ask for language preference
            await whatsappService.sendButtons(from, t('language_prompt', 'en') + "\n" + t('language_prompt', 'fr'), [
                { id: "lang_en", title: t('language_english', 'en') },
                { id: "lang_fr", title: t('language_french', 'fr') }
            ]);
            await setSession(from, { step: 'AWAITING_LANGUAGE_CHOICE' });
            break;

        case 'AWAITING_LANGUAGE_CHOICE':
            if (inputLower === 'lang_en' || inputLower === 'english' || inputLower === 'en') {
                await setSession(from, { step: 'MAIN_MENU', lang: 'en' });
                // Recursively call to show main menu
                return handleIncomingMessage(from, null, null);
            } else if (inputLower === 'lang_fr' || inputLower === 'french' || inputLower === 'fr' || inputLower === 'francais' || inputLower === 'français') {
                await setSession(from, { step: 'MAIN_MENU', lang: 'fr' });
                // Recursively call to show main menu
                return handleIncomingMessage(from, null, null);
            } else {
                // Repeat language selection
                await whatsappService.sendButtons(from, t('language_prompt', 'en') + "\n" + t('language_prompt', 'fr'), [
                    { id: "lang_en", title: t('language_english', 'en') },
                    { id: "lang_fr", title: t('language_french', 'fr') }
                ]);
            }
            break;

        case 'MAIN_MENU':
            await whatsappService.sendButtons(from, t('welcome', lang), [
                { id: "action_wash", title: t('btn_start_wash', lang) },
                { id: "action_services", title: t('btn_services', lang) },
                { id: "action_my_status", title: t('btn_my_status', lang) }
            ]);
            await setSession(from, { step: 'AWAITING_MENU_CHOICE', lang });
            break;

        case 'AWAITING_MENU_CHOICE':
            if (inputLower === 'action_services') {
                const servicesMessage = `${t('services_title', lang)}\n\n` +
                    `${t('services_washing', lang)}\n` +
                    `${t('services_express', lang)}\n` +
                    `${t('services_standard', lang)}\n` +
                    `${t('services_intensive', lang)}\n\n` +
                    `${t('services_drying', lang)}\n\n` +
                    `${t('services_capacity', lang)}\n\n` +
                    `${t('services_amenities', lang)}\n\n` +
                    `${t('services_ready', lang)}`;

                await whatsappService.sendButtons(from, servicesMessage, [
                    { id: "action_wash", title: t('btn_start_wash', lang) },
                    { id: "action_availability", title: t('btn_availability', lang) },
                    { id: "action_cancel", title: t('btn_main_menu', lang) }
                ]);
                await setSession(from, { step: 'AWAITING_MENU_CHOICE', lang });
            } else if (inputLower === 'action_wash') {
                // Check business hours - use shortest cycle to see if ANY wash is possible
                const shortestCycleDuration = parseInt(config.CYCLES.SHORT.duration);
                const businessHoursCheck = canStartCycle(shortestCycleDuration);
                const hoursInfo = getBusinessHoursInfo();

                if (!businessHoursCheck.allowed) {
                    // Handle different closing scenarios
                    if (businessHoursCheck.reason === 'before_opening') {
                        await whatsappService.sendButtons(from, t('closed_before_opening', lang, {
                            openTime: hoursInfo.openTime,
                            closeTime: hoursInfo.closeTime
                        }), [
                            { id: "action_services", title: t('btn_services', lang) },
                            { id: "action_cancel", title: t('btn_main_menu', lang) }
                        ]);
                    } else if (businessHoursCheck.reason === 'after_closing') {
                        await whatsappService.sendButtons(from, t('closed_after_closing', lang, {
                            openTime: hoursInfo.openTime,
                            closeTime: hoursInfo.closeTime
                        }), [
                            { id: "action_services", title: t('btn_services', lang) },
                            { id: "action_cancel", title: t('btn_main_menu', lang) }
                        ]);
                    } else {
                        // cycle_exceeds_closing - even shortest cycle won't finish in time
                        await whatsappService.sendButtons(from, t('cycle_too_late_all', lang, {
                            closeTime: hoursInfo.closeTime,
                            currentTime: hoursInfo.currentTime,
                            openTime: hoursInfo.openTime
                        }), [
                            { id: "action_services", title: t('btn_services', lang) },
                            { id: "action_cancel", title: t('btn_main_menu', lang) }
                        ]);
                    }
                    break;
                }

                const availableMachines = await getAvailableMachines();
                const totalAvailable = availableMachines.length;

                if (totalAvailable === 0) {
                    await whatsappService.sendButtons(from, t('no_machines', lang), [
                        { id: "action_availability", title: t('btn_availability', lang) },
                        { id: "action_cancel", title: t('btn_back_menu', lang) }
                    ]);
                    break;
                }

                await whatsappService.sendButtons(from, t('machines_available', lang, { count: totalAvailable }), [
                    { id: "select_enter_id", title: t('btn_enter_id', lang) },
                    { id: "select_choose", title: t('btn_choose_list', lang) },
                    { id: "action_cancel", title: t('btn_cancel', lang) }
                ]);
                await setSession(from, { step: 'SELECT_MACHINE_METHOD', lang });
            } else if (inputLower === 'action_my_status') {
                // Check user's active wash cycle
                const activeCycle = await getUserActiveCycle(from);

                if (activeCycle) {
                    const remainingMs = activeCycle.cycleEndsAt - new Date();
                    const remainingMins = Math.ceil(remainingMs / (1000 * 60));
                    const machineName = formatMachineName(activeCycle.machineId);

                    await whatsappService.sendButtons(from, t('status_active', lang, {
                        machine: machineName,
                        minutes: remainingMins,
                        amount: activeCycle.amount
                    }), [
                        { id: "action_availability", title: t('btn_availability', lang) },
                        { id: "action_cancel", title: t('btn_main_menu', lang) }
                    ]);
                } else {
                    await whatsappService.sendButtons(from, t('status_none', lang), [
                        { id: "action_wash", title: t('btn_start_wash', lang) },
                        { id: "action_availability", title: t('btn_availability', lang) },
                        { id: "action_cancel", title: t('btn_main_menu', lang) }
                    ]);
                }
                await setSession(from, { step: 'AWAITING_MENU_CHOICE', lang });
            } else if (inputLower === 'action_availability') {
                // Show machine availability (max 2 available + max 2 in-use)
                const availableMachines = await getAvailableMachines();
                const inUseMachines = await getInUseMachines();

                let statusMsg = t('availability_title', lang) + "\n\n";

                // Show available machines (max 2)
                const availableToShow = availableMachines.slice(0, 2);
                if (availableToShow.length > 0) {
                    statusMsg += t('availability_available', lang) + "\n";
                    availableToShow.forEach(m => {
                        statusMsg += t('machine_available_icon', lang, { name: m.name }) + "\n";
                    });
                    if (availableMachines.length > 2) {
                        statusMsg += t('availability_more_available', lang, { count: availableMachines.length - 2 }) + "\n";
                    }
                } else {
                    statusMsg += t('availability_none', lang) + "\n";
                }

                // Show in-use machines (max 2)
                const inUseToShow = inUseMachines.slice(0, 2);
                if (inUseToShow.length > 0) {
                    statusMsg += "\n" + t('availability_in_use', lang) + "\n";
                    inUseToShow.forEach(m => {
                        statusMsg += t('machine_in_use_icon', lang, { name: m.name, minutes: m.remainingMinutes }) + "\n";
                    });
                    if (inUseMachines.length > 2) {
                        statusMsg += t('availability_more_in_use', lang, { count: inUseMachines.length - 2 }) + "\n";
                    }
                }

                // Summary
                statusMsg += "\n" + t('availability_total', lang, {
                    available: availableMachines.length,
                    inUse: inUseMachines.length
                });

                await whatsappService.sendButtons(from, statusMsg, [
                    { id: "action_wash", title: t('btn_start_wash', lang) },
                    { id: "action_cancel", title: t('btn_main_menu', lang) }
                ]);
                await setSession(from, { step: 'AWAITING_MENU_CHOICE', lang });
            }
            break;

        case 'SELECT_MACHINE_METHOD':
            if (inputLower === 'select_enter_id') {
                await whatsappService.sendButtons(from, t('enter_machine_id', lang), [
                    { id: "action_cancel", title: t('btn_cancel', lang) }
                ]);
                await setSession(from, { step: 'AWAITING_MANUAL_MACHINE_ID', lang });
            } else if (inputLower === 'select_choose') {
                const availableMachines = await getAvailableMachines();
                const totalAvailable = availableMachines.length;
                // Show max 2 machines as buttons
                const machinesToShow = availableMachines.slice(0, 2);

                let message = t('available_machines_title', lang, { count: totalAvailable });
                if (totalAvailable > 2) {
                    message += t('available_machines_more', lang, { count: totalAvailable });
                }

                const buttons = machinesToShow.map(m => ({
                    id: `machine_${m.id}`,
                    title: m.name
                }));
                buttons.push({ id: "action_cancel", title: t('btn_cancel', lang) });

                await whatsappService.sendButtons(from, message, buttons);
                await setSession(from, { step: 'AWAITING_MACHINE_SELECTION', lang });
            }
            break;

        case 'AWAITING_MANUAL_MACHINE_ID':
            // User is typing a machine ID manually
            if (inputLower === 'action_cancel') break; // Handled by global reset

            // Handle button clicks - user might click "Choose from List" instead of typing
            if (inputLower === 'select_choose') {
                // Redirect to machine list selection
                await setSession(from, { step: 'SELECT_MACHINE_METHOD', lang });
                return handleIncomingMessage(from, null, 'select_choose');
            }
            if (inputLower === 'select_enter_id') {
                // User wants to try entering ID again - just re-prompt
                await whatsappService.sendButtons(from, t('enter_machine_id', lang), [
                    { id: "select_choose", title: t('btn_choose_list', lang) },
                    { id: "action_cancel", title: t('btn_cancel', lang) }
                ]);
                break;
            }

            // Try to find and validate the machine
            const normalizedInput = input.toLowerCase().replace(/\s+/g, '_'); // "Washer 1" -> "washer_1"
            const foundMachine = findMachine(normalizedInput);

            if (!foundMachine) {
                await whatsappService.sendButtons(from, t('machine_not_found', lang, { input }), [
                    { id: "select_choose", title: t('btn_choose_list', lang) },
                    { id: "action_cancel", title: t('btn_cancel', lang) }
                ]);
                break;
            }

            if (!(await isMachineAvailable(foundMachine))) {
                await whatsappService.sendButtons(from, t('machine_unavailable', lang, { machine: foundMachine }), [
                    { id: "select_enter_id", title: t('btn_enter_another', lang) },
                    { id: "select_choose", title: t('btn_choose_list', lang) },
                    { id: "action_cancel", title: t('btn_cancel', lang) }
                ]);
                break;
            }

            // Machine is valid and available - proceed to cycle selection
            await setSession(from, { step: 'SELECT_CYCLE', machineId: foundMachine, lang });
            const machineName = formatMachineName(foundMachine);
            await whatsappService.sendButtons(from, t('machine_selected', lang, { machine: machineName }), [
                { id: "cycle_short", title: t('cycle_short', lang, { duration: config.CYCLES.SHORT.duration, price: config.PRICING.SHORT_CYCLE }) },
                { id: "cycle_long", title: t('cycle_long', lang, { duration: config.CYCLES.LONG.duration, price: config.PRICING.LONG_CYCLE }) },
                { id: "action_cancel", title: t('btn_cancel', lang) }
            ]);
            break;

        case 'AWAITING_MACHINE_SELECTION':
            // Handle button clicks for navigation
            if (inputLower === 'select_choose') {
                // Refresh the machine list
                await setSession(from, { step: 'SELECT_MACHINE_METHOD', lang });
                return handleIncomingMessage(from, null, 'select_choose');
            }
            if (inputLower === 'select_enter_id') {
                // Switch to manual entry mode
                await setSession(from, { step: 'SELECT_MACHINE_METHOD', lang });
                return handleIncomingMessage(from, null, 'select_enter_id');
            }

            // User selected a machine from the list
            if (inputLower.startsWith('machine_')) {
                const selectedMachineId = input.replace('machine_', '');

                if (!(await isMachineAvailable(selectedMachineId))) {
                    await whatsappService.sendButtons(from, t('machine_just_taken', lang), [
                        { id: "select_choose", title: t('btn_choose_again', lang) },
                        { id: "action_cancel", title: t('btn_cancel', lang) }
                    ]);
                    break;
                }

                await setSession(from, { step: 'SELECT_CYCLE', machineId: selectedMachineId, lang });
                const selectedName = formatMachineName(selectedMachineId);
                await whatsappService.sendButtons(from, t('machine_selected', lang, { machine: selectedName }), [
                    { id: "cycle_short", title: t('cycle_short', lang, { duration: config.CYCLES.SHORT.duration, price: config.PRICING.SHORT_CYCLE }) },
                    { id: "cycle_long", title: t('cycle_long', lang, { duration: config.CYCLES.LONG.duration, price: config.PRICING.LONG_CYCLE }) },
                    { id: "action_cancel", title: t('btn_cancel', lang) }
                ]);
            } else if (input && !inputLower.startsWith('action_')) {
                // User typed something that's not a button - try to find machine by name
                const typedNormalized = input.toLowerCase().replace(/\s+/g, '_');
                const typedMachine = findMachine(typedNormalized);

                if (typedMachine && await isMachineAvailable(typedMachine)) {
                    await setSession(from, { step: 'SELECT_CYCLE', machineId: typedMachine, lang });
                    const typedName = formatMachineName(typedMachine);
                    await whatsappService.sendButtons(from, t('machine_selected', lang, { machine: typedName }), [
                        { id: "cycle_short", title: t('cycle_short', lang, { duration: config.CYCLES.SHORT.duration, price: config.PRICING.SHORT_CYCLE }) },
                        { id: "cycle_long", title: t('cycle_long', lang, { duration: config.CYCLES.LONG.duration, price: config.PRICING.LONG_CYCLE }) },
                        { id: "action_cancel", title: t('btn_cancel', lang) }
                    ]);
                } else {
                    // Couldn't find or machine not available - show list again
                    const availableMachines = await getAvailableMachines();
                    const machinesToShow = availableMachines.slice(0, 2);
                    const buttons = machinesToShow.map(m => ({
                        id: `machine_${m.id}`,
                        title: m.name
                    }));
                    buttons.push({ id: "action_cancel", title: t('btn_cancel', lang) });

                    await whatsappService.sendButtons(from, t('machine_not_found', lang, { input }) + "\n\n" + t('available_machines_title', lang, { count: availableMachines.length }), buttons);
                }
            }
            break;

        case 'SELECT_CYCLE':
            if (inputLower === 'cycle_short' || inputLower === 'cycle_long') {
                const isLongCycle = inputLower === 'cycle_long';
                const amount = isLongCycle ? config.PRICING.LONG_CYCLE : config.PRICING.SHORT_CYCLE;
                const pulseCount = isLongCycle ? config.CYCLES.LONG.pulseCount : config.CYCLES.SHORT.pulseCount;
                const duration = parseInt(isLongCycle ? config.CYCLES.LONG.duration : config.CYCLES.SHORT.duration);
                const { machineId } = session;

                if (!machineId) {
                    await whatsappService.sendMessage(from, t('session_error', lang));
                    await clearSession(from);
                    break;
                }

                // Check if this specific cycle can complete before closing time
                const cycleTimeCheck = canStartCycle(duration);
                if (!cycleTimeCheck.allowed && cycleTimeCheck.reason === 'cycle_exceeds_closing') {
                    // This specific cycle is too long, but shorter one might work
                    const shortDuration = parseInt(config.CYCLES.SHORT.duration);
                    const shortCycleCheck = canStartCycle(shortDuration);

                    if (shortCycleCheck.allowed && isLongCycle) {
                        // Only the short cycle is available - suggest it
                        await whatsappService.sendButtons(from, t('cycle_too_late', lang, {
                            closeTime: cycleTimeCheck.closeTime,
                            duration: duration,
                            currentTime: cycleTimeCheck.currentTime,
                            lastAllowedTime: cycleTimeCheck.lastAllowedTime
                        }), [
                            { id: "cycle_short", title: t('cycle_short', lang, { duration: config.CYCLES.SHORT.duration, price: config.PRICING.SHORT_CYCLE }) },
                            { id: "action_cancel", title: t('btn_main_menu', lang) }
                        ]);
                    } else {
                        // No cycles available - too late for any
                        const hoursInfo = getBusinessHoursInfo();
                        await whatsappService.sendButtons(from, t('cycle_too_late_all', lang, {
                            closeTime: hoursInfo.closeTime,
                            currentTime: hoursInfo.currentTime,
                            openTime: hoursInfo.openTime
                        }), [
                            { id: "action_services", title: t('btn_services', lang) },
                            { id: "action_cancel", title: t('btn_main_menu', lang) }
                        ]);
                        await setSession(from, { step: 'MAIN_MENU', lang });
                    }
                    break;
                }

                const machName = formatMachineName(machineId);
                await whatsappService.sendMessage(from, t('payment_initiating', lang, {
                    machine: machName,
                    duration,
                    amount
                }));

                // Delegate payment request AND database logging to the paymentService
                const result = await requestPayment(from, amount, `Wash cycle for ${machineId}`, machineId, pulseCount, duration);

                if (result.success) {
                    await whatsappService.sendMessage(from, t('payment_success', lang));
                } else {
                    const errorMsg = result.message || "Payment request failed";
                    await whatsappService.sendButtons(from, t('payment_failed', lang, { error: errorMsg }), [
                        { id: "action_wash", title: t('btn_try_again', lang) },
                        { id: "action_cancel", title: t('btn_main_menu', lang) }
                    ]);
                }

                // Clear session but preserve language
                await setSession(from, { step: 'MAIN_MENU', lang });
            }
            break;

        // --- FEEDBACK STATES ---
        case 'AWAITING_FEEDBACK':
            // Handle feedback rating buttons (5, 3, or 1 stars)
            if (inputLower?.startsWith('feedback_')) {
                const ratingMatch = inputLower.match(/feedback_(\d)/);
                if (ratingMatch) {
                    const rating = parseInt(ratingMatch[1]);
                    const feedbackResult = await processFeedbackRating(from, rating);

                    if (feedbackResult.success) {
                        if (feedbackResult.needsComment) {
                            // Non-5 star rating: ask for comment
                            await whatsappService.sendMessage(from, feedbackResult.message);
                        } else {
                            // 5 stars: thank them and return to menu
                            await whatsappService.sendButtons(from, feedbackResult.message, [
                                { id: "action_wash", title: t('btn_start_wash', lang) },
                                { id: "action_cancel", title: t('btn_main_menu', lang) }
                            ]);
                        }
                    } else {
                        await whatsappService.sendMessage(from, t('session_error', lang));
                        await setSession(from, { step: 'MAIN_MENU', lang });
                    }
                }
            }
            break;

        case 'AWAITING_FEEDBACK_COMMENT':
            // Handle feedback comment or skip
            if (inputLower === 'skip' || inputLower === 'passer') {
                const skipResult = await skipFeedbackComment(from);
                await whatsappService.sendButtons(from, skipResult.message, [
                    { id: "action_wash", title: t('btn_start_wash', lang) },
                    { id: "action_cancel", title: t('btn_main_menu', lang) }
                ]);
            } else if (input && input.length > 0) {
                // User provided a comment
                const commentResult = await processFeedbackComment(from, input);

                if (commentResult.tooLong) {
                    // Comment too long - ask to shorten it
                    await whatsappService.sendMessage(from, commentResult.message);
                } else {
                    // Comment accepted
                    await whatsappService.sendButtons(from, commentResult.message, [
                        { id: "action_wash", title: t('btn_start_wash', lang) },
                        { id: "action_cancel", title: t('btn_main_menu', lang) }
                    ]);
                }
            }
            break;

        default:
            // Check if user has language set
            if (!session.lang) {
                // New user - show language selection
                await setSession(from, { step: 'LANGUAGE_SELECTION' });
                return handleIncomingMessage(from, null, null);
            }

            await whatsappService.sendButtons(from, t('not_understood', lang), [
                { id: "action_cancel", title: t('btn_main_menu', lang) }
            ]);
            await setSession(from, { step: 'AWAITING_MENU_CHOICE', lang });
            break;
    }
};

module.exports = { handleIncomingMessage };
