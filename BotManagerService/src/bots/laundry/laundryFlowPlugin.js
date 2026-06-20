const { MachineStore } = require('../../core/machines/machineStore');
const { MachineStatus } = require('../../core/machines/machineTypes');
const { getPaymentService } = require('../../core/payments/paymentService');
const { redisManager } = require('../../core/redisManager');

function normalizeChoice(text) {
  return String(text || '').trim();
}

function nowDate() {
  return new Date();
}

function isOpenNow({ openHour, closeHour, date } = {}) {
  const d = date || nowDate();
  const hour = d.getHours();
  const start = typeof openHour === 'number' ? openHour : 7;
  const end = typeof closeHour === 'number' ? closeHour : 21;

  // Simple same-day window (e.g., 7..21). If end <= start, treat as "always open".
  if (end <= start) return true;
  return hour >= start && hour < end;
}

function getLang(flowContext) {
  const raw = flowContext.get('lang') || flowContext.get('language');
  const lang = String(raw || '').toLowerCase();
  return lang === 'en' || lang === 'fr' ? lang : null;
}

function t(flowContext, key, vars) {
  const lang = getLang(flowContext) || 'fr';
  const v = vars && typeof vars === 'object' ? vars : {};

  const texts = {
    fr: {
      menuText: '👋 Bienvenue chez *Smart Laundry*\n\nChoisissez une option :',
      navHint: "Tape *menu* pour le menu • *back* pour revenir • *cancel* pour annuler",
      helpText:
        "🧭 *Aide*\n\n- Utilisez les boutons / listes pour naviguer\n- Nous lançons la machine automatiquement après paiement\n- Tapez *menu* à tout moment pour revenir au menu",
      hoursClosedText: (p) => `⏰ Désolé, nous sommes fermés maintenant.\n\nHeures: ${p.openHour}h - ${p.closeHour}h\n\n${p.navHint}`,
      hoursOpenText: (p) => `⏰ Nous sommes ouverts ✅\n\nHeures: ${p.openHour}h - ${p.closeHour}h\n\n${p.navHint}`,
      pickMachineText: '🧺 Sélectionnez une machine disponible :',
      pickProgramText: (p) => `🌀 Choisissez un programme pour *${p.machineId}* :`,
      statusPickMachineText: '📟 Choisissez une machine pour voir le statut :',
      paymentPendingText: (p) =>
        `✅ Paiement initié\n\nRéférence: ${p.paymentExternalRef}\nMontant: ${p.paymentAmount} ${p.paymentCurrency}\nMachine: ${p.machineId}\nProgramme: ${p.programLabel}\n\nConfirmez sur votre téléphone. La machine démarrera automatiquement après paiement.`,
      feedbackAskText: '⭐️ Donnez une note pour votre expérience :',
      feedbackCommentPromptText: '💬 Merci. Laissez un commentaire (optionnel) :',
      feedbackThanksText: '🙏 Merci pour votre retour !'
    },
    en: {
      menuText: '👋 Welcome to *Smart Laundry*\n\nChoose an option:',
      navHint: "Type *menu* for menu • *back* to go back • *cancel* to cancel",
      helpText:
        "🧭 *Help*\n\n- Use buttons / lists to navigate\n- We start the machine automatically after payment\n- Type *menu* anytime to return",
      hoursClosedText: (p) => `⏰ Sorry, we are closed right now.\n\nHours: ${p.openHour}:00 - ${p.closeHour}:00\n\n${p.navHint}`,
      hoursOpenText: (p) => `⏰ We are open ✅\n\nHours: ${p.openHour}:00 - ${p.closeHour}:00\n\n${p.navHint}`,
      pickMachineText: '🧺 Select an available machine:',
      pickProgramText: (p) => `🌀 Choose a program for *${p.machineId}* :`,
      statusPickMachineText: '📟 Pick a machine to view status:',
      paymentPendingText: (p) =>
        `✅ Payment initiated\n\nReference: ${p.paymentExternalRef}\nAmount: ${p.paymentAmount} ${p.paymentCurrency}\nMachine: ${p.machineId}\nProgram: ${p.programLabel}\n\nPlease confirm on your phone. We will start the machine automatically once payment is completed.`,
      feedbackAskText: '⭐️ Rate your experience:',
      feedbackCommentPromptText: '💬 Thanks. Leave a comment (optional):',
      feedbackThanksText: '🙏 Thanks for your feedback!'
    }
  };

  const table = texts[lang] || texts.fr;
  const value = table[key];
  if (typeof value === 'function') return value(v);
  return value != null ? String(value) : '';
}

function formatMachines(machines) {
  if (!machines.length) return 'None right now.';
  return machines
    .map((machine) => {
      const machineNameSuffix = machine.name ? ` - ${machine.name}` : '';
      return `${machine.machineId}${machineNameSuffix}`;
    })
    .join('\n');
}

function buildMachineListSections({ machines, sectionTitle } = {}) {
  const safeMachines = Array.isArray(machines) ? machines : [];
  const rows = safeMachines.map((m) => {
    const id = String(m.machineId);
    const title = m.name ? `${id} • ${m.name}` : id;
    const description = m.type ? String(m.type) : undefined;
    return { id, title, description };
  });

  return [
    {
      title: String(sectionTitle || 'Machines'),
      rows
    }
  ];
}

function buildProgramsListSections({ programs, currency, sectionTitle } = {}) {
  const safePrograms = Array.isArray(programs) ? programs : [];
  const rows = safePrograms.map((p) => {
    const id = String(p.id);
    const title = String(p.label || p.id);
    const price = p.amount != null ? `${p.amount} ${p.currency || currency || 'XAF'}` : '';
    const durationMinutes = p.durationSeconds != null ? Math.round(Number(p.durationSeconds) / 60) : null;
    const descParts = [];
    if (price) descParts.push(price);
    if (durationMinutes) descParts.push(`${durationMinutes} min`);
    const description = descParts.length ? descParts.join(' • ') : undefined;
    return { id, title, description };
  });

  return [
    {
      title: String(sectionTitle || 'Programs'),
      rows
    }
  ];
}

function buildMenuSections(flowContext) {
  const lang = getLang(flowContext) || 'fr';
  const rows =
    lang === 'en'
      ? [
          { id: 'action_start', title: '🧺 Start laundry', description: 'Pick machine and program' },
          { id: 'action_status', title: '📟 Status', description: 'Check a machine status' },
          { id: 'action_hours', title: '⏰ Business hours', description: 'See opening hours' },
          { id: 'action_help', title: '🧭 Help', description: 'How it works' },
          { id: 'action_language', title: '🌍 Language', description: 'English / Français' }
        ]
      : [
          { id: 'action_start', title: '🧺 Lancer un lavage', description: 'Choisir machine et programme' },
          { id: 'action_status', title: '📟 Statut', description: 'Voir le statut d’une machine' },
          { id: 'action_hours', title: '⏰ Horaires', description: "Voir les heures d’ouverture" },
          { id: 'action_help', title: '🧭 Aide', description: 'Comment ça marche' },
          { id: 'action_language', title: '🌍 Langue', description: 'English / Français' }
        ];

  flowContext.set('menuText', t(flowContext, 'menuText'));
  flowContext.set('navHint', t(flowContext, 'navHint'));
  flowContext.set('menuSections', [
    {
      title: lang === 'en' ? 'Menu' : 'Menu',
      rows
    }
  ]);
}

function getMachineType(botConfig, machineId) {
  const machines = Array.isArray(botConfig.machines) ? botConfig.machines : [];
  const matchingMachineConfig = machines.find((machineConfig) => String(machineConfig.id).toUpperCase() === String(machineId).toUpperCase());
  return matchingMachineConfig ? matchingMachineConfig.type : null;
}

function getPrograms(botConfig, machineType) {
  const programsByType = botConfig && botConfig.programs && typeof botConfig.programs === 'object' ? botConfig.programs : {};
  const programsForMachineType = programsByType && programsByType[machineType] ? programsByType[machineType] : [];
  return Array.isArray(programsForMachineType) ? programsForMachineType : [];
}

class LaundryFlowPlugin {
  constructor({ botConfig } = {}) {
    this.botConfig = botConfig;
    this.machineStore = new MachineStore();
  }

  async handleAction(flowContext, { action } = {}) {
    if (action === 'i18n.ensureLanguage') {
      const existingLang = getLang(flowContext);
      if (!existingLang) {
        flowContext.goto('language_prompt');
        return true;
      }

      buildMenuSections(flowContext);
      flowContext.goto('main_menu');
      return true;
    }

    if (action === 'i18n.setLanguage') {
      const choice = normalizeChoice(flowContext.get('languageChoice'));
      const lang = choice === 'lang_en' || /^en$/i.test(choice) ? 'en' : 'fr';
      flowContext.set('lang', lang);
      buildMenuSections(flowContext);
      flowContext.goto('main_menu');
      return true;
    }

    if (action === 'menu.route') {
      const choice = normalizeChoice(flowContext.get('menuChoice'));
      if (choice === '1') {
        flowContext.goto('machines_list_action');
        return true;
      }
      if (choice === '2') {
        flowContext.goto('status_prompt');
        return true;
      }
      if (choice === '3') {
        flowContext.goto('help');
        return true;
      }

      flowContext.set('errorText', 'Invalid choice.');
      flowContext.goto('welcome');
      return true;
    }

    if (action === 'menu.routeV2') {
      const menuAction = normalizeChoice(flowContext.get('menuAction'));

      if (menuAction === 'action_language') {
        flowContext.goto('language_prompt');
        return true;
      }
      if (menuAction === 'action_help') {
        flowContext.set('helpText', t(flowContext, 'helpText'));
        flowContext.set('navHint', t(flowContext, 'navHint'));
        flowContext.goto('help_message');
        return true;
      }
      if (menuAction === 'action_hours') {
        flowContext.goto('hours_action');
        return true;
      }
      if (menuAction === 'action_status') {
        flowContext.goto('status_machine_list_action');
        return true;
      }
      if (menuAction === 'action_start') {
        flowContext.goto('machines_list_action');
        return true;
      }

      // Unknown selection => re-render menu
      buildMenuSections(flowContext);
      flowContext.goto('main_menu');
      return true;
    }

    if (action === 'hours.check') {
      const openHour = Number(process.env.LAUDRY_OPEN_HOUR || 7);
      const closeHour = Number(process.env.LAUDRY_CLOSE_HOUR || 21);
      const navHint = t(flowContext, 'navHint');
      const open = isOpenNow({ openHour, closeHour });
      flowContext.set('navHint', navHint);
      flowContext.set(
        'hoursText',
        open ? t(flowContext, 'hoursOpenText', { openHour, closeHour, navHint }) : t(flowContext, 'hoursClosedText', { openHour, closeHour, navHint })
      );
      return true;
    }

    if (action === 'hours.requireOpen') {
      const openHour = Number(process.env.LAUDRY_OPEN_HOUR || 7);
      const closeHour = Number(process.env.LAUDRY_CLOSE_HOUR || 21);
      if (!isOpenNow({ openHour, closeHour })) {
        const navHint = t(flowContext, 'navHint');
        flowContext.set('navHint', navHint);
        flowContext.set('hoursText', t(flowContext, 'hoursClosedText', { openHour, closeHour, navHint }));
        flowContext.goto('hours_message');
        return true;
      }

      // Business open: continue as normal (next state)
      return true;
    }

    if (action === 'machines.listAvailable' || action === 'machines.listAvailableV2') {
      const botId = flowContext.bot && flowContext.bot.botId ? flowContext.bot.botId : 'laundry';
      const machineConfigs = Array.isArray(flowContext.bot.machines) ? flowContext.bot.machines : [];

      const availableMachines = [];
      const availableMachineIds = [];

      for (const machineConfig of machineConfigs) {
        // eslint-disable-next-line no-await-in-loop
        const machineRecord = await this.machineStore.getMachine({ botId, machineId: machineConfig.id });
        const machineStatus = machineRecord && machineRecord.status ? machineRecord.status : MachineStatus.AVAILABLE;
        if (machineStatus === MachineStatus.AVAILABLE) {
          availableMachines.push({ machineId: machineConfig.id, name: machineConfig.name || null, type: machineConfig.type || null });
          availableMachineIds.push(String(machineConfig.id).toUpperCase());
        }
      }

      flowContext.set('availableMachineIds', availableMachineIds);
      flowContext.set('availableMachinesText', formatMachines(availableMachines));
      flowContext.set('errorText', '');

      flowContext.set('pickMachineText', t(flowContext, 'pickMachineText'));
      flowContext.set('navHint', t(flowContext, 'navHint'));
      flowContext.set(
        'machineSections',
        buildMachineListSections({
          machines: availableMachines,
          sectionTitle: getLang(flowContext) === 'en' ? 'Available machines' : 'Machines disponibles'
        })
      );

      if (action === 'machines.listAvailableV2') {
        flowContext.goto('machine_pick');
      }
      return true;
    }

    if (action === 'machines.validateSelection') {
      const rawMachineIdInput = normalizeChoice(flowContext.get('machineIdInput'));
      const selectedMachineId = rawMachineIdInput.toUpperCase();
      const allowedMachineIds = flowContext.get('availableMachineIds') || [];

      if (!selectedMachineId || !Array.isArray(allowedMachineIds) || !allowedMachineIds.includes(selectedMachineId)) {
        flowContext.set('errorText', `Machine '${rawMachineIdInput}' is not available. Try another.`);
        flowContext.goto('machines_prompt');
        return true;
      }

      flowContext.set('machineId', selectedMachineId);
      flowContext.set('machineType', getMachineType(flowContext.bot, selectedMachineId));
      flowContext.set('errorText', '');
      flowContext.goto('programs_list_action');
      return true;
    }

    if (action === 'programs.list' || action === 'programs.listV2') {
      const machineType = flowContext.get('machineType');
      const programs = getPrograms(flowContext.bot, machineType);

      if (!programs.length) {
        flowContext.set('programOptionsText', 'No programs configured.');
        flowContext.set('programChoiceMap', {});
        return true;
      }

      const programChoiceMap = {};
      const programOptionLines = programs.map((programDefinition, index) => {
        const optionNumber = String(index + 1);
        programChoiceMap[optionNumber] = programDefinition;
        const priceSuffix = programDefinition.amount != null ? ` - ${programDefinition.amount} ${programDefinition.currency || 'XAF'}` : '';
        return `${optionNumber}) ${programDefinition.label || programDefinition.id}${priceSuffix}`;
      });

      flowContext.set('programChoiceMap', programChoiceMap);
      flowContext.set('programOptionsText', programOptionLines.join('\n'));
      flowContext.set('errorText', '');

      flowContext.set('pickProgramText', t(flowContext, 'pickProgramText', { machineId: flowContext.get('machineId') }));
      flowContext.set('navHint', t(flowContext, 'navHint'));
      flowContext.set(
        'programSections',
        buildProgramsListSections({
          programs,
          currency: 'XAF',
          sectionTitle: getLang(flowContext) === 'en' ? 'Programs' : 'Programmes'
        })
      );

      if (action === 'programs.listV2') {
        flowContext.goto('program_pick');
      }
      return true;
    }

    if (action === 'programs.validate' || action === 'programs.validateV2') {
      const programChoiceInput = normalizeChoice(flowContext.get('programChoiceInput'));
      const programChoiceMap = flowContext.get('programChoiceMap') || {};
      const selectedProgram = programChoiceMap[programChoiceInput] || null;

      // For list UI, we store the program id directly
      const machineType = flowContext.get('machineType');
      const programs = getPrograms(flowContext.bot, machineType);
      const selectedById = programs.find((p) => String(p.id) === String(programChoiceInput));
      const resolvedProgram = selectedProgram || selectedById;

      if (!resolvedProgram) {
        flowContext.set('errorText', 'Invalid program choice.');
        flowContext.goto(action === 'programs.validateV2' ? 'program_pick' : 'programs_prompt');
        return true;
      }

      flowContext.set('programId', resolvedProgram.id);
      flowContext.set('programLabel', resolvedProgram.label || resolvedProgram.id);
      flowContext.set('paymentAmount', resolvedProgram.amount);
      flowContext.set('paymentCurrency', resolvedProgram.currency || 'XAF');
      flowContext.set('durationSeconds', resolvedProgram.durationSeconds || null);
      flowContext.set('errorText', '');

      // Always gate with business hours in v2 flow
      if (action === 'programs.validateV2') {
        flowContext.goto('hours_before_payment');
        return true;
      }

      flowContext.goto('payment_initiate_action');
      return true;
    }

    if (action === 'payments.initiate') {
      const { gateway } = getPaymentService();
      const botId = flowContext.bot && flowContext.bot.botId ? flowContext.bot.botId : 'laundry';

      const machineId = flowContext.get('machineId');
      const programId = flowContext.get('programId');
      const paymentAmount = Number(flowContext.get('paymentAmount') || 0);
      const paymentCurrency = flowContext.get('paymentCurrency') || 'XAF';

      const paymentReference = `${botId}-${machineId}-${Date.now()}`;

      const paymentRecord = await gateway.initiatePayment({
        botId,
        amount: paymentAmount,
        currency: paymentCurrency,
        phoneNumber: flowContext.from,
        reference: paymentReference,
        description: `Laundry ${machineId} (${programId})`,
        metadata: { machineId, program: programId }
      });

      flowContext.set('paymentTransactionId', paymentRecord.transactionId);
      flowContext.set('paymentExternalRef', paymentRecord.externalRef || paymentRecord.transactionId);
      flowContext.set('paymentProvider', paymentRecord.provider);
      flowContext.set('paymentAmount', paymentRecord.amount);
      flowContext.set('paymentCurrency', paymentRecord.currency);

      flowContext.set(
        'paymentPendingText',
        t(flowContext, 'paymentPendingText', {
          paymentExternalRef: paymentRecord.externalRef || paymentRecord.transactionId,
          paymentAmount: paymentRecord.amount,
          paymentCurrency: paymentRecord.currency,
          machineId,
          programLabel: flowContext.get('programLabel')
        })
      );
      flowContext.set('navHint', t(flowContext, 'navHint'));

      flowContext.goto('payment_pending');
      return true;
    }

    if (action === 'machines.listForStatus') {
      const botId = flowContext.bot && flowContext.bot.botId ? flowContext.bot.botId : 'laundry';
      const machineConfigs = Array.isArray(flowContext.bot.machines) ? flowContext.bot.machines : [];

      const rows = machineConfigs.map((m) => ({ machineId: m.id, name: m.name || null, type: m.type || null }));
      flowContext.set('statusPickMachineText', t(flowContext, 'statusPickMachineText'));
      flowContext.set('navHint', t(flowContext, 'navHint'));
      flowContext.set(
        'statusMachineSections',
        buildMachineListSections({
          machines: rows,
          sectionTitle: getLang(flowContext) === 'en' ? 'Machines' : 'Machines'
        })
      );

      flowContext.goto('status_machine_list');
      return true;
    }

    if (action === 'machines.status') {
      const botId = flowContext.bot && flowContext.bot.botId ? flowContext.bot.botId : 'laundry';
      const rawMachineIdInput = normalizeChoice(flowContext.get('statusMachineId')) || flowContext.get('machineId') || '';
      const machineId = String(rawMachineIdInput).toUpperCase();

      if (!machineId) {
        flowContext.set('machineStatusText', 'No machine selected.');
        return true;
      }

      const machineRecord = await this.machineStore.getMachine({ botId, machineId });
      if (!machineRecord) {
        flowContext.set('machineStatusText', `No status found for ${machineId}.`);
        return true;
      }

      const remainingSeconds = machineRecord.remainingSeconds != null ? Number(machineRecord.remainingSeconds) : null;
      const remainingTimeSuffix =
        remainingSeconds != null && !Number.isNaN(remainingSeconds)
          ? `\nTime remaining: ${Math.ceil(remainingSeconds / 60)} min`
          : '';

      const heartbeatSuffix = machineRecord.lastHeartbeatAt ? `\nLast heartbeat: ${machineRecord.lastHeartbeatAt}` : '';
      flowContext.set(
        'machineStatusText',
        `Machine ${machineId}: ${machineRecord.status || 'UNKNOWN'}\nProgram: ${machineRecord.program || '-'}${remainingTimeSuffix}${heartbeatSuffix}`
      );

      return true;
    }

    if (action === 'feedback.route') {
      const choice = normalizeChoice(flowContext.get('ratingChoice'));
      const match = /^rate_(\d)$/.exec(choice);
      const rating = match ? Number(match[1]) : null;

      if (!rating) {
        flowContext.goto('feedback_prompt');
        return true;
      }

      flowContext.set('rating', rating);
      flowContext.set('feedbackAskText', t(flowContext, 'feedbackAskText'));
      flowContext.set('feedbackCommentPromptText', t(flowContext, 'feedbackCommentPromptText'));
      flowContext.set('feedbackThanksText', t(flowContext, 'feedbackThanksText'));
      flowContext.set('navHint', t(flowContext, 'navHint'));

      // If low rating, ask comment; otherwise thank directly
      if (rating <= 3) {
        flowContext.goto('feedback_comment_prompt');
        return true;
      }

      flowContext.goto('feedback_save');
      return true;
    }

    if (action === 'feedback.save') {
      const botId = flowContext.bot && flowContext.bot.botId ? flowContext.bot.botId : 'laundry';
      const rating = Number(flowContext.get('rating') || 0);
      const comment = normalizeChoice(flowContext.get('ratingComment'));
      const transactionId = flowContext.get('paymentTransactionId') || null;

      const key = `feedback:${botId}:${flowContext.from}:${transactionId || 'no_tx'}`;
      await redisManager.setex(
        key,
        60 * 60 * 24 * 7,
        JSON.stringify({
          botId,
          from: flowContext.from,
          transactionId,
          rating,
          comment: comment || null,
          createdAt: new Date().toISOString()
        })
      );

      flowContext.set('feedbackThanksText', t(flowContext, 'feedbackThanksText'));
      flowContext.set('navHint', t(flowContext, 'navHint'));
      return true;
    }

    return false;
  }
}

module.exports = { LaundryFlowPlugin };
