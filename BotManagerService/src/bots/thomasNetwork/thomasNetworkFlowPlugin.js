const { getPaymentService } = require('../../core/payments/paymentService');
const { MachineStore } = require('../../core/machines/machineStore');
const { MachineStatus } = require('../../core/machines/machineTypes');
const { redisManager } = require('../../core/redisManager');

function normalizeChoice(text) {
  return String(text || '').trim();
}

function pressingOrderKey({ botId, code } = {}) {
  return `pressingOrder:${botId}:${String(code || '').trim().toUpperCase()}`;
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch (_err) {
    return null;
  }
}

function formatEtaFromSeconds(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const minutes = Math.ceil(s / 60);
  if (minutes >= 120) {
    const hours = Math.ceil(minutes / 60);
    return `${hours}h`;
  }
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const rem = minutes % 60;
    if (rem === 0) return `${hours}h`;
    return `${hours}h ${rem}min`;
  }
  return `${minutes}min`;
}

function formatEtaFromMs(ms) {
  const s = Math.ceil(Math.max(0, Number(ms) || 0) / 1000);
  return formatEtaFromSeconds(s);
}

function getLaundryWasherIds() {
  try {
    // eslint-disable-next-line global-require
    const laundryConfig = require('../../../configs/bots/laundry.bot.json');
    const machines = Array.isArray(laundryConfig.machines) ? laundryConfig.machines : [];
    return machines.filter((m) => m && m.type === 'WASHER' && m.id).map((m) => String(m.id));
  } catch (_err) {
    return ['W1', 'W2', 'W3', 'W4', 'W5', 'W6'];
  }
}

function shortenButtonTitle(label) {
  const normalized = String(label || '').trim();
  if (!normalized) return 'Option';
  // WhatsApp reply button title max length is limited; keep it short.
  return normalized.length > 20 ? `${normalized.slice(0, 17)}...` : normalized;
}

function getBandwidthOptions(botConfig) {
  const networkAccessConfig = botConfig && botConfig.networkAccess ? botConfig.networkAccess : {};
  const bandwidthOptions = Array.isArray(networkAccessConfig.bandwidthOptions) ? networkAccessConfig.bandwidthOptions : [];
  return bandwidthOptions;
}

function getMaxDevices(botConfig) {
  const networkAccessConfig = botConfig && botConfig.networkAccess ? botConfig.networkAccess : {};
  const maxDevices = Number(networkAccessConfig.maxDevices || 10);
  return Number.isFinite(maxDevices) && maxDevices > 0 ? maxDevices : 10;
}

function buildBandwidthOptionsText(bandwidthOptions, paymentCurrency) {
  if (!bandwidthOptions.length) return 'No options configured.';

  return bandwidthOptions
    .map((bandwidthOption, index) => {
      const optionNumber = String(index + 1);
      const labelText = String(bandwidthOption.label || bandwidthOption.id || '').trim();
      const baseAmountText = bandwidthOption.baseAmount != null ? `${bandwidthOption.baseAmount} ${paymentCurrency}` : null;
      const perDeviceAmountText =
        bandwidthOption.perDeviceAmount != null ? `+${bandwidthOption.perDeviceAmount} ${paymentCurrency} / appareil supplémentaire` : null;

      const lines = [`${optionNumber}) ⚡ ${labelText}`];

      if (baseAmountText) lines.push(`   💰 Base: ${baseAmountText}`);
      if (perDeviceAmountText) lines.push(`   📱 ${perDeviceAmountText}`);

      return lines.join('\n');
    })
    .join('\n');
}

function calculateFinalAmount({ baseAmount, perDeviceAmount, deviceCount }) {
  const safeDeviceCount = Number.isFinite(deviceCount) ? deviceCount : 1;
  const base = Number(baseAmount || 0);
  const perDevice = Number(perDeviceAmount || 0);

  const additionalDevices = Math.max(safeDeviceCount - 1, 0);
  return base + additionalDevices * perDevice;
}

class ThomasNetworkFlowPlugin {
  constructor({ botConfig } = {}) {
    this.botConfig = botConfig;
    this.machineStore = new MachineStore();
  }

  async handleAction(flowContext, { action } = {}) {
    if (action === 'menu.route') {
      const menuChoice = normalizeChoice(flowContext.get('menuChoice'));

      if (menuChoice === '1') {
        flowContext.goto('bandwidth_list_action');
        flowContext.set('errorText', '');
        return true;
      }

      if (menuChoice === '2') {
        flowContext.goto('pressing_menu');
        flowContext.set('errorText', '');
        return true;
      }

      flowContext.set('errorText', 'Choix invalide. Réponds avec 1 ou 2.');
      flowContext.goto('welcome');
      return true;
    }

    if (action === 'pressing.route') {
      const choice = normalizeChoice(flowContext.get('pressingChoice'));

      if (choice === 'pressing_back') {
        flowContext.goto('welcome');
        return true;
      }

      if (choice === 'pressing_washers') {
        flowContext.goto('pressing_washer_action');
        return true;
      }

      if (choice === 'pressing_track') {
        flowContext.goto('pressing_code_prompt');
        return true;
      }

      flowContext.goto('pressing_menu');
      return true;
    }

    if (action === 'pressing.checkWashers') {
      const laundryBotId = process.env.PRESSING_LAUNDRY_BOT_ID || 'laundry';
      const washerIds = getLaundryWasherIds();

      const available = [];
      let soonestRemainingSeconds = null;

      for (const washerId of washerIds) {
        // eslint-disable-next-line no-await-in-loop
        const machine = await this.machineStore.getMachine({ botId: laundryBotId, machineId: washerId });
        const status = machine && machine.status ? String(machine.status).toUpperCase() : MachineStatus.AVAILABLE;

        if (status === MachineStatus.AVAILABLE) {
          available.push(washerId);
          continue;
        }

        const remainingSeconds = machine && machine.remainingSeconds != null ? Number(machine.remainingSeconds) : null;
        if (status === MachineStatus.IN_USE && remainingSeconds != null && Number.isFinite(remainingSeconds) && remainingSeconds >= 0) {
          soonestRemainingSeconds =
            soonestRemainingSeconds == null ? remainingSeconds : Math.min(soonestRemainingSeconds, remainingSeconds);
        }
      }

      if (available.length) {
        flowContext.set(
          'pressingWasherText',
          `🧺 *Disponibilité machines*\n\n✅ Vous avez une machine disponible.\n\nDisponibles maintenant: *${available.join(', ')}*`
        );
        return true;
      }

      if (soonestRemainingSeconds != null) {
        flowContext.set(
          'pressingWasherText',
          `🧺 *Disponibilité machines*\n\n⏳ Prochaine machine disponible dans environ *${formatEtaFromSeconds(soonestRemainingSeconds)}*.`
        );
        return true;
      }

      flowContext.set(
        'pressingWasherText',
        "🧺 *Disponibilité machines*\n\n⚠️ Impossible de déterminer la disponibilité pour le moment. Réessaye plus tard."
      );
      return true;
    }

    if (action === 'pressing.checkCode') {
      const botId = flowContext.bot && flowContext.bot.botId ? flowContext.bot.botId : 'thomas_network';
      const code = normalizeChoice(flowContext.get('pressingCode')).toUpperCase();

      if (!code) {
        flowContext.set('pressingCodeText', '⚠️ Code invalide. Merci de renvoyer votre code pressing.');
        flowContext.goto('pressing_code_prompt');
        return true;
      }

      const raw = await redisManager.get(pressingOrderKey({ botId, code }));
      const record = raw ? safeJsonParse(raw) : null;

      if (!record) {
        flowContext.set(
          'pressingCodeText',
          `🏷️ *Suivi Pressing*\n\n❓ Code *${code}* introuvable.\nVérifie le code ou contacte le personnel.`
        );
        return true;
      }

      const status = record.status ? String(record.status).toUpperCase() : 'IN_PROGRESS';
      const readyAt = record.readyAt ? new Date(record.readyAt).getTime() : null;
      const now = Date.now();

      if (status === 'READY' || (readyAt != null && Number.isFinite(readyAt) && readyAt <= now)) {
        flowContext.set(
          'pressingCodeText',
          `🏷️ *Suivi Pressing*\n\n✅ Vos vêtements sont prêts !\nCode: *${code}*`
        );
        return true;
      }

      if (readyAt != null && Number.isFinite(readyAt) && readyAt > now) {
        flowContext.set(
          'pressingCodeText',
          `🏷️ *Suivi Pressing*\n\n⏳ Pas encore prêt.\nCode: *${code}*\nDisponible dans environ: *${formatEtaFromMs(readyAt - now)}*`
        );
        return true;
      }

      flowContext.set(
        'pressingCodeText',
        `🏷️ *Suivi Pressing*\n\n⏳ Traitement en cours.\nCode: *${code}*`
      );
      return true;
    }

    if (action === 'bandwidth.list') {
      const bandwidthOptions = getBandwidthOptions(flowContext.bot);
      const maxDevices = getMaxDevices(flowContext.bot);
      const paymentCurrency = (flowContext.bot && flowContext.bot.networkAccess && flowContext.bot.networkAccess.currency) || 'XAF';

      const bandwidthChoiceMap = {};
      const bandwidthButtons = [];
      bandwidthOptions.forEach((bandwidthOption, index) => {
        const optionNumber = String(index + 1);
        bandwidthChoiceMap[optionNumber] = bandwidthOption;

        bandwidthButtons.push({
          id: optionNumber,
          title: shortenButtonTitle(bandwidthOption.label || bandwidthOption.id || optionNumber)
        });
      });

      flowContext.set('maxDevices', maxDevices);
      flowContext.set('paymentCurrency', paymentCurrency);
      flowContext.set('bandwidthChoiceMap', bandwidthChoiceMap);
      flowContext.set('bandwidthButtons', bandwidthButtons.slice(0, 3));
      flowContext.set('bandwidthOptionsText', buildBandwidthOptionsText(bandwidthOptions, paymentCurrency));
      flowContext.set('errorText', '');
      return true;
    }

    if (action === 'bandwidth.validate') {
      const bandwidthChoiceInput = normalizeChoice(flowContext.get('bandwidthChoiceInput'));
      const bandwidthChoiceMap = flowContext.get('bandwidthChoiceMap') || {};
      const selectedBandwidthOption = bandwidthChoiceMap[bandwidthChoiceInput];

      if (!selectedBandwidthOption) {
        flowContext.set('errorText', 'Débit invalide. Réponds avec un numéro de la liste.');
        flowContext.goto('bandwidth_prompt');
        return true;
      }

      flowContext.set('bandwidthId', selectedBandwidthOption.id);
      flowContext.set('bandwidthLabel', selectedBandwidthOption.label || selectedBandwidthOption.id);
      flowContext.set('bandwidthBaseAmount', selectedBandwidthOption.baseAmount);
      flowContext.set('bandwidthPerDeviceAmount', selectedBandwidthOption.perDeviceAmount || 0);
      flowContext.set('errorText', '');
      flowContext.goto('devices_prompt');
      return true;
    }

    if (action === 'devices.calculate') {
      const deviceCountInput = normalizeChoice(flowContext.get('deviceCountInput'));
      const deviceCount = Number(deviceCountInput);

      const allowedDeviceCounts = [1, 2, 4, 6];
      if (!allowedDeviceCounts.includes(deviceCount)) {
        flowContext.set('errorText', "Choix invalide. Appuie sur 1, 2, 4, ou 6 appareils.");
        flowContext.goto('devices_prompt');
        return true;
      }

      const maxDevices = Number(flowContext.get('maxDevices') || getMaxDevices(flowContext.bot));
      if (!Number.isFinite(deviceCount) || deviceCount < 1 || deviceCount > maxDevices) {
        flowContext.set('errorText', `Nombre d'appareils invalide. Entre un nombre entre 1 et ${maxDevices}.`);
        flowContext.goto('devices_prompt');
        return true;
      }

      const baseAmount = Number(flowContext.get('bandwidthBaseAmount') || 0);
      const perDeviceAmount = Number(flowContext.get('bandwidthPerDeviceAmount') || 0);

      const paymentAmount = calculateFinalAmount({ baseAmount, perDeviceAmount, deviceCount });
      const paymentCurrency = flowContext.get('paymentCurrency') || 'XAF';

      flowContext.set('deviceCount', deviceCount);
      flowContext.set('paymentAmount', paymentAmount);
      flowContext.set('paymentCurrency', paymentCurrency);
      flowContext.set('errorText', '');
      flowContext.goto('payment_initiate_action');
      return true;
    }

    if (action === 'payments.initiate') {
      const { gateway } = getPaymentService();

      const botId = flowContext.bot && flowContext.bot.botId ? flowContext.bot.botId : 'thomas_network';
      const paymentCurrency = flowContext.get('paymentCurrency') || 'XAF';
      const paymentAmount = Number(flowContext.get('paymentAmount') || 0);

      const bandwidthId = flowContext.get('bandwidthId') || null;
      const deviceCount = Number(flowContext.get('deviceCount') || 1);

      const paymentReference = `${botId}-${bandwidthId || 'access'}-${Date.now()}`;

      const preferredProvider =
        flowContext.bot && flowContext.bot.payments && flowContext.bot.payments.preferredProvider
          ? String(flowContext.bot.payments.preferredProvider)
          : undefined;

      const paymentRecord = await gateway.initiatePayment({
        botId,
        amount: paymentAmount,
        currency: paymentCurrency,
        phoneNumber: flowContext.from,
        reference: paymentReference,
        description: `Network access (1 day) - ${bandwidthId || ''} - ${deviceCount} device(s)`,
        preferredProvider,
        metadata: {
          service: 'thomas_network_access',
          durationDays: 1,
          bandwidthId,
          bandwidthLabel: flowContext.get('bandwidthLabel') || bandwidthId,
          deviceCount
        }
      });

      flowContext.set('paymentTransactionId', paymentRecord.transactionId);
      flowContext.set('paymentExternalRef', paymentRecord.externalRef || paymentRecord.transactionId);
      flowContext.set('paymentProvider', paymentRecord.provider);
      flowContext.set('paymentAmount', paymentRecord.amount);
      flowContext.set('paymentCurrency', paymentRecord.currency);

      flowContext.goto('payment_pending');
      return true;
    }

    return false;
  }
}

module.exports = { ThomasNetworkFlowPlugin, calculateFinalAmount };
