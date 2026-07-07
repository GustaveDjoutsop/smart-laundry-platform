package com.botmanager.core.i18n;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Slf4j
@Service
public class TranslationService {

    private static final Pattern VARIABLE_PATTERN = Pattern.compile("\\{(\\w+)}");

    private final Map<String, Map<Language, String>> translations = new HashMap<>();

    public TranslationService() {
        initializeTranslations();
    }

    public String translate(String key, Language language) {
        return translate(key, language, Map.of());
    }

    public String translate(String key, Language language, Map<String, Object> variables) {
        Map<Language, String> langMap = translations.get(key);
        if (langMap == null) {
            log.warn("Translation key not found: {}", key);

            return key;
        }

        String template = langMap.getOrDefault(language, langMap.get(Language.EN));
        if (template == null) {
            return key;
        }

        return interpolate(template, variables);
    }

    private String interpolate(String template, Map<String, Object> variables) {
        if (variables.isEmpty()) {
            return template;
        }

        Matcher matcher = VARIABLE_PATTERN.matcher(template);
        StringBuilder result = new StringBuilder();

        while (matcher.find()) {
            String varName = matcher.group(1);
            Object value = variables.get(varName);
            String replacement = value != null ? value.toString() : "";
            matcher.appendReplacement(result, Matcher.quoteReplacement(replacement));
        }

        matcher.appendTail(result);

        return result.toString();
    }

    private void addTranslation(String key, String en, String fr) {
        Map<Language, String> langMap = new HashMap<>();
        langMap.put(Language.EN, en);
        langMap.put(Language.FR, fr);
        translations.put(key, langMap);
    }

    private void initializeTranslations() {
        // Language selection
        addTranslation("language_prompt",
                "Welcome! Please select your language:",
                "Bienvenue! Veuillez choisir votre langue:");
        addTranslation("language_english", "English", "English");
        addTranslation("language_french", "Français", "Français");

        // Main menu
        addTranslation("welcome",
                "Welcome to Smart Laundry! \uD83E\uDDFA\nYour unique self-service Laundry!\n\nWhat would you like to do?",
                "Bienvenue chez Smart Laundry! \uD83E\uDDFA\nVotre laverie libre-service unique!\n\nQue souhaitez-vous faire?");
        addTranslation("btn_start_wash", "\uD83E\uDDFA Start a Wash", "\uD83E\uDDFA Lancer Lavage");
        addTranslation("btn_start_dry", "\uD83C\uDF2A\uFE0F Start a Dry", "\uD83C\uDF2A\uFE0F Lancer S\u00E9chage");
        addTranslation("btn_menu", "\uD83D\uDCF1 Menu", "\uD83D\uDCF1 Menu");
        addTranslation("btn_services", "\uD83D\uDCCB Our Services", "\uD83D\uDCCB Nos Services");
        addTranslation("btn_my_status", "\uD83D\uDCCA My Status", "\uD83D\uDCCA Mon Statut");
        addTranslation("btn_main_menu", "\uD83C\uDFE0 Main Menu", "\uD83C\uDFE0 Menu");
        addTranslation("btn_cancel", "❌ Cancel", "❌ Annuler");
        addTranslation("btn_try_again", "\uD83D\uDD04 Try Again", "\uD83D\uDD04 Réessayer");
        addTranslation("btn_back_menu", "\uD83D\uDD04 Back to Menu", "\uD83D\uDD04 Retour Menu");

        // Services menu
        addTranslation("services_title", "\uD83D\uDCCB *Our Services*", "\uD83D\uDCCB *Nos Services*");
        addTranslation("services_washing", "\uD83E\uDDFA *Washing Programs:*", "\uD83E\uDDFA *Programmes de Lavage:*");
        addTranslation("services_express", "  • Express Wash ({duration} min) - {price} XAF", "  • Lavage Express ({duration} min) - {price} XAF");
        addTranslation("services_standard", "  • Standard Wash ({duration} min) - {price} XAF", "  • Lavage Standard ({duration} min) - {price} XAF");
        addTranslation("services_drying", "🌪️ *Drying Programs:*", "🌪️ *Programmes de Séchage:*");
        addTranslation("services_dry_express", "  • Express Dry ({duration} min) - {price} XAF", "  • Séchage Express ({duration} min) - {price} XAF");
        addTranslation("services_dry_standard", "  • Standard Dry ({duration} min) - {price} XAF", "  • Séchage Standard ({duration} min) - {price} XAF");
        addTranslation("services_capacity", "\uD83D\uDCCF *Machine Capacity:* 10 kg per load", "\uD83D\uDCCF *Capacité Machine:* 10 kg par charge");
        addTranslation("services_amenities", "✨ *Amenities:*\n  • \uD83D\uDCF6 Free WiFi\n  • ☕ Waiting Area & Café", "✨ *Commodités:*\n  • \uD83D\uDCF6 WiFi Gratuit\n  • ☕ Espace d'Attente & Café");
        addTranslation("services_ready", "Ready to get started?", "Prêt à commencer?");
        addTranslation("btn_availability", "\uD83D\uDCCA Availability", "\uD83D\uDCCA Disponibilité");

        // Machine selection
        addTranslation("machines_available",
                "\uD83E\uDDFA {count} machine(s) available.\n\nHow would you like to select your machine?",
                "\uD83E\uDDFA {count} machine(s) disponible(s).\n\nComment souhaitez-vous sélectionner votre machine?");
        addTranslation("no_machines",
                "❌ Sorry, no machines are currently available.\n\nPlease try again later.",
                "❌ Désolé, aucune machine n'est disponible actuellement.\n\nVeuillez réessayer plus tard.");
        addTranslation("wash_flow_disabled",
                "ℹ️ Starting a wash from the bot is not available right now.\n\nYou can still check machine availability and our services.",
                "ℹ️ Le lancement d'un lavage depuis le bot n'est pas disponible pour le moment.\n\nVous pouvez toujours consulter la disponibilité des machines et nos services.");
        addTranslation("btn_enter_id", "\uD83D\uDCDD Enter ID", "\uD83D\uDCDD Entrer ID");
        addTranslation("btn_choose_list", "\uD83D\uDCCB Choose List", "\uD83D\uDCCB Voir Liste");
        addTranslation("enter_machine_id",
                "\uD83D\uDCDD Please type the machine ID or name (e.g., 'washer_01' or 'Washer 1'):\n\n_Type 'cancel' to go back._",
                "\uD83D\uDCDD Veuillez saisir l'ID ou le nom de la machine (ex: 'washer_01' ou 'Washer 1'):\n\n_Tapez 'cancel' pour revenir._");
        addTranslation("machine_not_found",
                "❌ Machine \"{input}\" not found.\n\nPlease enter a valid machine ID or name.",
                "❌ Machine \"{input}\" introuvable.\n\nVeuillez entrer un ID ou nom de machine valide.");
        addTranslation("machine_unavailable",
                "❌ Machine \"{machine}\" is currently not available.\n\nPlease choose another machine.",
                "❌ La machine \"{machine}\" n'est pas disponible actuellement.\n\nVeuillez choisir une autre machine.");
        addTranslation("btn_enter_another", "\uD83D\uDCDD Enter Another", "\uD83D\uDCDD Autre ID");
        addTranslation("machine_selected",
                "✅ {machine} is available!\n\nPlease choose your wash cycle:",
                "✅ {machine} est disponible!\n\nVeuillez choisir votre cycle de lavage:");
        addTranslation("machine_just_taken",
                "❌ Sorry, this machine just became unavailable.\n\nPlease choose another machine.",
                "❌ Désolé, cette machine vient d'être prise.\n\nVeuillez choisir une autre machine.");
        addTranslation("btn_choose_again", "\uD83D\uDCCB Choose Again", "\uD83D\uDCCB Rechoisir");
        addTranslation("available_machines_title",
                "\uD83D\uDCCB Available Machines ({count} total):\n\nSelect one:",
                "\uD83D\uDCCB Machines Disponibles ({count} au total):\n\nSélectionnez-en une:");
        addTranslation("available_machines_more",
                "\n\n_Showing 2 of {count} available. Use \"Enter Machine ID\" to access others._",
                "\n\n_Affichage de 2 sur {count} disponibles. Utilisez \"Entrer ID Machine\" pour les autres._");

        // Cycle selection
        addTranslation("cycle_short", "{duration} Min - {price} XAF", "{duration} Min - {price} XAF");
        addTranslation("cycle_long", "{duration} Min - {price} XAF", "{duration} Min - {price} XAF");

        // Payment
        addTranslation("payment_initiating",
                "⏳ Initiating payment...\n\n\uD83D\uDCCD Machine: {machine}\n⏱️ Duration: {duration} minutes\n\uD83D\uDCB0 Amount: {amount} XAF\n\nPlease check your phone to approve the payment.",
                "⏳ Initialisation du paiement...\n\n\uD83D\uDCCD Machine: {machine}\n⏱️ Durée: {duration} minutes\n\uD83D\uDCB0 Montant: {amount} XAF\n\nVeuillez vérifier votre téléphone pour approuver le paiement.");
        addTranslation("payment_success",
                "✅ Payment prompt sent!\n\nPlease enter your PIN on your phone. The machine will start automatically once payment is confirmed.\n\nType 'start' for a new transaction.",
                "✅ Demande de paiement envoyée!\n\nVeuillez entrer votre PIN sur votre téléphone. La machine démarrera automatiquement une fois le paiement confirmé.\n\nTapez 'start' pour une nouvelle transaction.");
        addTranslation("payment_failed", "❌ {error}", "❌ {error}");
        addTranslation("session_error",
                "❌ Something went wrong. Please type 'start' to begin again.",
                "❌ Une erreur s'est produite. Veuillez taper 'start' pour recommencer.");
        addTranslation("payment_confirmed",
                "✅ *Payment Confirmed!*\n\n\uD83D\uDCB0 Amount: {amount} XAF\n\uD83D\uDCCD Machine: {machine}\n⏱️ Duration: {duration} minutes\n\n\uD83D\uDE80 *The machine is now ready!*\nPlease close the door and press START to begin your wash cycle.\n\n⏰ Your cycle ends at: {endTime}",
                "✅ *Paiement Confirmé!*\n\n\uD83D\uDCB0 Montant: {amount} XAF\n\uD83D\uDCCD Machine: {machine}\n⏱️ Durée: {duration} minutes\n\n\uD83D\uDE80 *La machine est prête!*\nVeuillez fermer la porte et appuyer sur START pour démarrer votre cycle.\n\n⏰ Fin du cycle à: {endTime}");
        addTranslation("payment_failed_notification",
                "❌ *Payment Failed*\n\nYour payment for {machine} was not completed.\n\n\uD83D\uDCCB Reason: {reason}\n\nPlease try again or contact support if the problem persists.",
                "❌ *Paiement Échoué*\n\nVotre paiement pour {machine} n'a pas abouti.\n\n\uD83D\uDCCB Raison: {reason}\n\nVeuillez réessayer ou contacter le support si le problème persiste.");
        addTranslation("tn_payment_confirmed",
                "✅ *Payment Confirmed!*\n\n\uD83D\uDCB0 Amount: {amount} XAF\n\uD83D\uDCF6 Service: {service}\n\uD83D\uDCBB Devices: {deviceCount}\n\n\uD83D\uDE80 *Your internet access has been activated!*",
                "✅ *Paiement Confirmé!*\n\n\uD83D\uDCB0 Montant: {amount} XAF\n\uD83D\uDCF6 Service: {service}\n\uD83D\uDCBB Appareils: {deviceCount}\n\n\uD83D\uDE80 *Votre accès internet a été activé !*");
        addTranslation("tn_payment_failed",
                "❌ *Payment Failed*\n\nYour payment for {service} access was not completed.\n\n\uD83D\uDCCB Reason: {reason}\n\nPlease try again or contact support if the problem persists.",
                "❌ *Paiement Échoué*\n\nVotre paiement pour l'accès {service} n'a pas abouti.\n\n\uD83D\uDCCB Raison: {reason}\n\nVeuillez réessayer ou contacter le support si le problème persiste.");

        // Status
        addTranslation("status_active",
                "\uD83D\uDD04 Your Wash Status:\n\n\uD83D\uDCCD Machine: {machine}\n⏱️ Time Remaining: {minutes} minute(s)\n\uD83D\uDCB0 Paid: {amount} XAF\n\nYour laundry will be ready soon!",
                "\uD83D\uDD04 Statut de votre Lavage:\n\n\uD83D\uDCCD Machine: {machine}\n⏱️ Temps Restant: {minutes} minute(s)\n\uD83D\uDCB0 Payé: {amount} XAF\n\nVotre linge sera bientôt prêt!");
        addTranslation("status_none",
                "ℹ️ You don't have any active wash cycle at the moment.\n\nWould you like to start one?",
                "ℹ️ Vous n'avez aucun cycle de lavage actif pour le moment.\n\nSouhaitez-vous en démarrer un?");
        addTranslation("status_active_cycle",
                "✅ You have an active wash cycle on machine *{machine}*.\n\nYour laundry is in progress!",
                "✅ Vous avez un cycle de lavage actif sur la machine *{machine}*.\n\nVotre linge est en cours!");

        // Availability
        addTranslation("availability_title", "\uD83D\uDCCA Machine Availability:", "\uD83D\uDCCA Disponibilité des Machines:");
        addTranslation("availability_available", "✅ Available:", "✅ Disponibles:");
        addTranslation("availability_none", "✅ Available: None", "✅ Disponibles: Aucune");
        addTranslation("availability_in_use", "\uD83D\uDD04 In Use:", "\uD83D\uDD04 En Cours:");
        addTranslation("availability_more_available", "  _...and {count} more available_", "  _...et {count} autre(s) disponible(s)_");
        addTranslation("availability_more_in_use", "  _...and {count} more in use_", "  _...et {count} autre(s) en cours_");
        addTranslation("availability_total", "\uD83D\uDCC8 Total: {available} available, {inUse} in use", "\uD83D\uDCC8 Total: {available} disponible(s), {inUse} en cours");
        addTranslation("machine_available_icon", "  \uD83D\uDFE2 {name}", "  \uD83D\uDFE2 {name}");
        addTranslation("machine_in_use_icon", "  \uD83D\uDD34 {name} ({minutes} min left)", "  \uD83D\uDD34 {name} ({minutes} min restantes)");

        // Errors
        addTranslation("not_understood",
                "Sorry, I didn't understand that.\n\nType 'start' or press the button below to see the main menu.",
                "Désolé, je n'ai pas compris.\n\nTapez 'start' ou appuyez sur le bouton ci-dessous pour voir le menu principal.");

        // System / service errors
        addTranslation("machine_service_unavailable",
                "⏳ *System is loading...*\n\nOur machine status system is temporarily unavailable. Please try again in a moment.",
                "⏳ *Système en cours de chargement...*\n\nNotre système de statut des machines est temporairement indisponible. Veuillez réessayer dans un instant.");

        // Cycle completion
        addTranslation("cycle_completed",
                "\uD83C\uDF89 *Your laundry is ready!*\n\n\uD83D\uDCCD Machine: {machine}\n⏱️ Cycle completed at: {endTime}\n\n\uD83D\uDC55 Please collect your clothes so the next customer can use the machine.\n\nThank you for using Smart Laundry! \uD83E\uDDFA",
                "\uD83C\uDF89 *Votre linge est prêt!*\n\n\uD83D\uDCCD Machine: {machine}\n⏱️ Cycle terminé à: {endTime}\n\n\uD83D\uDC55 Veuillez récupérer vos vêtements pour que le prochain client puisse utiliser la machine.\n\nMerci d'avoir utilisé Smart Laundry! \uD83E\uDDFA");

        // Cycle almost done (proactive reminder, sent by PaymentManagementService)
        addTranslation("cycle_almost_done",
                "⏰ *Almost done!*\n\n📍 Machine: {machine}\n⏱️ About {minutes} minute(s) left.\n\nPlease get ready to collect your laundry soon!",
                "⏰ *Bientôt terminé!*\n\n📍 Machine: {machine}\n⏱️ Environ {minutes} minute(s) restante(s).\n\nPréparez-vous à récupérer votre linge bientôt!");

        // Feedback
        addTranslation("feedback_request",
                "⭐ *How was your experience?*\n\n\uD83D\uDCCD Machine: {machine}\n\nPlease rate your wash cycle:",
                "⭐ *Comment était votre expérience?*\n\n\uD83D\uDCCD Machine: {machine}\n\nVeuillez noter votre cycle de lavage:");
        addTranslation("btn_rating_5", "⭐⭐⭐⭐⭐ Excellent", "⭐⭐⭐⭐⭐ Excellent");
        addTranslation("btn_rating_3", "⭐⭐⭐ Average", "⭐⭐⭐ Moyen");
        addTranslation("btn_rating_1", "⭐ Very Poor", "⭐ Très Mauvais");
        addTranslation("feedback_thanks_high",
                "\uD83D\uDE4F *Thank you for your feedback!*\n\nWe're glad you had a great experience. See you next time! \uD83E\uDDFA",
                "\uD83D\uDE4F *Merci pour votre avis!*\n\nNous sommes ravis que vous ayez passé un bon moment. À bientôt! \uD83E\uDDFA");
        addTranslation("feedback_thanks_low",
                "\uD83D\uDE4F *Thank you for your feedback.*\n\nPlease tell us how we can improve your experience.\n\n\uD83D\uDCDD *Write your comment* (max 100 words)\n\n_Or type 'skip' to continue without comment._",
                "\uD83D\uDE4F *Merci pour votre avis.*\n\nDites-nous comment nous pouvons améliorer votre expérience.\n\n\uD83D\uDCDD *Écrivez votre commentaire* (max 100 mots)\n\n_Ou tapez 'passer' pour continuer sans commentaire._");
        addTranslation("feedback_comment_received",
                "\uD83D\uDCDD *Comment received.*\n\nOur team will review your feedback. Thank you for helping us improve!\n\nType 'start' to begin a new wash.",
                "\uD83D\uDCDD *Commentaire reçu.*\n\nNotre équipe examinera votre avis. Merci de nous aider à nous améliorer!\n\nTapez 'start' pour démarrer un nouveau lavage.");
        addTranslation("feedback_skipped",
                "\uD83D\uDC4D No problem! Thank you for your rating.\n\nType 'start' to begin a new wash.",
                "\uD83D\uDC4D Pas de problème! Merci pour votre note.\n\nTapez 'start' pour démarrer un nouveau lavage.");
        addTranslation("feedback_comment_too_long",
                "⚠️ Your comment is too long ({words} words). Please keep it under 100 words.\n\n_Or type 'skip' to continue without comment._",
                "⚠️ Votre commentaire est trop long ({words} mots). Veuillez le limiter à 100 mots.\n\n_Ou tapez 'passer' pour continuer sans commentaire._");

        // Business hours
        addTranslation("closed_before_opening",
                "\uD83D\uDEAB *We're currently closed*\n\n\uD83D\uDD50 Our opening hours:\n\uD83D\uDCCD Open: {openTime}\n\uD83D\uDCCD Close: {closeTime}\n\nPlease come back during our business hours!",
                "\uD83D\uDEAB *Nous sommes actuellement fermés*\n\n\uD83D\uDD50 Nos horaires d'ouverture:\n\uD83D\uDCCD Ouverture: {openTime}\n\uD83D\uDCCD Fermeture: {closeTime}\n\nRevenez pendant nos heures d'ouverture!");
        addTranslation("closed_after_closing",
                "\uD83D\uDEAB *We're closed for today*\n\n\uD83D\uDD50 Our opening hours:\n\uD83D\uDCCD Open: {openTime}\n\uD83D\uDCCD Close: {closeTime}\n\nSee you tomorrow!",
                "\uD83D\uDEAB *Nous sommes fermés pour aujourd'hui*\n\n\uD83D\uDD50 Nos horaires d'ouverture:\n\uD83D\uDCCD Ouverture: {openTime}\n\uD83D\uDCCD Fermeture: {closeTime}\n\nÀ demain!");
        addTranslation("cycle_too_late",
                "⏰ *Too late for this cycle*\n\nWe close at {closeTime} and a {duration}-minute cycle would finish too late.\n\n\uD83D\uDD50 Current time: {currentTime}\n⏱️ Last start time for this cycle: {lastAllowedTime}\n\nPlease choose a shorter cycle or come back tomorrow!",
                "⏰ *Trop tard pour ce cycle*\n\nNous fermons à {closeTime} et un cycle de {duration} minutes se terminerait trop tard.\n\n\uD83D\uDD50 Heure actuelle: {currentTime}\n⏱️ Dernière heure de démarrage pour ce cycle: {lastAllowedTime}\n\nVeuillez choisir un cycle plus court ou revenir demain!");
        addTranslation("cycle_too_late_all",
                "⏰ *We're closing soon*\n\nWe close at {closeTime} and there's not enough time for any wash cycle.\n\n\uD83D\uDD50 Current time: {currentTime}\n\nPlease come back tomorrow during our business hours:\n\uD83D\uDCCD Open: {openTime}\n\uD83D\uDCCD Close: {closeTime}",
                "⏰ *Nous fermons bientôt*\n\nNous fermons à {closeTime} et il n'y a pas assez de temps pour un cycle de lavage.\n\n\uD83D\uDD50 Heure actuelle: {currentTime}\n\nRevenez demain pendant nos heures d'ouverture:\n\uD83D\uDCCD Ouverture: {openTime}\n\uD83D\uDCCD Fermeture: {closeTime}");

        // Payment failure reasons
        addTranslation("failure_reason_cancelled", "Payment was cancelled by user", "Paiement annulé par l'utilisateur");
        addTranslation("failure_reason_timeout", "Payment request timed out", "Délai de paiement expiré");
        addTranslation("failure_reason_insufficient_funds", "Insufficient balance in your account", "Solde insuffisant sur votre compte");
        addTranslation("failure_reason_declined", "Payment was declined", "Paiement refusé");
        addTranslation("failure_reason_unknown", "Unknown error", "Erreur inconnue");

        // CamPay error codes
        addTranslation("campay_err_ER101",
                "Payment service configuration error. Please contact support.",
                "Erreur de configuration du service de paiement. Veuillez contacter le support.");
        addTranslation("campay_err_ER102",
                "This phone number's mobile network is not supported for payments. Please use an MTN or Orange Cameroon number (+237).",
                "Le réseau mobile de ce numéro n'est pas pris en charge pour les paiements. Veuillez utiliser un numéro MTN ou Orange Cameroun (+237).");
        addTranslation("campay_err_ER103",
                "The payment amount is too low. Please check the amount and try again.",
                "Le montant du paiement est trop faible. Veuillez vérifier le montant et réessayer.");
        addTranslation("campay_err_ER104",
                "Insufficient funds in your mobile money account. Please top up and try again.",
                "Solde insuffisant sur votre compte mobile money. Veuillez recharger et réessayer.");
        addTranslation("campay_err_ER105",
                "Mobile money account not found. Please check your number and try again.",
                "Compte mobile money introuvable. Veuillez vérifier votre numéro et réessayer.");
        addTranslation("campay_err_ER106",
                "This payment reference has already been processed. Please check your payment status.",
                "Cette référence de paiement a déjà été traitée. Veuillez vérifier votre statut de paiement.");
        addTranslation("campay_err_default",
                "Payment could not be completed. Please try again or contact support.",
                "Le paiement n'a pas pu être effectué. Veuillez réessayer ou contacter le support.");
        addTranslation("campay_err_unavailable",
                "Payment service temporarily unavailable. Please try again later.",
                "Service de paiement temporairement indisponible. Veuillez réessayer plus tard.");
        addTranslation("campay_err_generic",
                "Payment request failed. Please try again.",
                "La demande de paiement a échoué. Veuillez réessayer.");

        // Reservation
        addTranslation("btn_reserve", "📅 Reserve", "📅 Réserver");
        addTranslation("reservation_disabled",
                "ℹ️ Machine reservation is not available right now.\n\nYou can still check availability or start a wash.",
                "ℹ️ La réservation de machine n'est pas disponible pour le moment.\n\nVous pouvez toujours consulter la disponibilité ou lancer un lavage.");
        addTranslation("reservation_select_date",
                "📅 *Choose a date for {machine}:*\n\nReservation slot: 1 hour",
                "📅 *Choisissez une date pour {machine}:*\n\nCréneau de réservation: 1 heure");
        addTranslation("reservation_date_section", "Available Dates", "Dates Disponibles");
        addTranslation("reservation_date_button", "Select Date", "Choisir Date");
        addTranslation("reservation_select_time",
                "🕐 *Choose a time on {date}:*\n\nMachine: {machine}",
                "🕐 *Choisissez une heure le {date}:*\n\nMachine: {machine}");
        addTranslation("reservation_time_section", "Available Times", "Heures Disponibles");
        addTranslation("reservation_time_button", "Select Time", "Choisir Heure");
        addTranslation("reservation_no_slots",
                "❌ No available time slots for this date.\n\nPlease go back to the main menu and try again.",
                "❌ Aucun créneau disponible pour cette date.\n\nRetournez au menu principal et réessayez.");
        addTranslation("reservation_confirm_msg",
                "📅 *Confirm Reservation*\n\n🖥️ Machine: {machine}\n📅 Date: {date}\n🕐 Time: {time}\n⏱️ Duration: {duration} min\n💰 Fee: {price} XAF\n\nConfirm to proceed with payment.",
                "📅 *Confirmer la Réservation*\n\n🖥️ Machine: {machine}\n📅 Date: {date}\n🕐 Heure: {time}\n⏱️ Durée: {duration} min\n💰 Frais: {price} XAF\n\nConfirmez pour procéder au paiement.");
        addTranslation("btn_confirm_reservation", "✅ Confirm", "✅ Confirmer");
        addTranslation("reservation_initiated",
                "✅ *Reservation request sent!*\n\nPlease approve the payment on your phone. Your machine will be reserved once payment is confirmed.\n\nType 'start' for the main menu.",
                "✅ *Demande de réservation envoyée!*\n\nVeuillez approuver le paiement sur votre téléphone. Votre machine sera réservée une fois le paiement confirmé.\n\nTapez 'start' pour le menu principal.");
        addTranslation("reservation_today", "Today", "Aujourd'hui");
        addTranslation("reservation_select_date_simple",
                "📅 *Choose a day for your reservation:*\n\nYour machine will be reserved for 1 hour.",
                "📅 *Choisissez un jour pour votre réservation:*\n\nVotre machine sera réservée pendant 1 heure.");
        addTranslation("reservation_select_time_simple",
                "🕐 *Choose a time on {date}:*\n\nSelect the start time for your 1-hour reservation.",
                "🕐 *Choisissez une heure le {date}:*\n\nSélectionnez l'heure de début pour votre réservation d'1 heure.");
        addTranslation("reservation_confirmed",
                "✅ *Reservation Confirmed!*\n\n💰 Amount paid: {amount} XAF\n🖥️ Machine: {machine}\n📅 Date: {date}\n🕐 Time: {time}\n\n🔑 *Your reservation code: {code}*\n\nPresent this code when you arrive to start your machine.\n\nType 'start' for the main menu.",
                "✅ *Réservation Confirmée!*\n\n💰 Montant payé: {amount} XAF\n🖥️ Machine: {machine}\n📅 Date: {date}\n🕐 Heure: {time}\n\n🔑 *Votre code de réservation: {code}*\n\nPrésentez ce code à votre arrivée pour démarrer votre machine.\n\nTapez 'start' pour le menu principal.");
        addTranslation("reservation_creation_failed",
                "⚠️ Your payment was confirmed but we could not finalize the reservation for {machine}. Please contact support.\n\nType 'start' for the main menu.",
                "⚠️ Votre paiement a été confirmé mais nous n'avons pas pu finaliser la réservation pour {machine}. Veuillez contacter le support.\n\nTapez 'start' pour le menu principal.");

        // Staff alert
        addTranslation("staff_alert_low_rating",
                "⚠️ *LOW RATING ALERT*\n\n\uD83D\uDCCD Machine: {machine}\n\uD83D\uDCF1 Customer: {phone}\n⭐ Rating: {rating}/5\n\uD83D\uDCAC Comment: {comment}\n\uD83D\uDD50 Time: {time}\n\nPlease follow up with the customer.",
                "⚠️ *ALERTE NOTE BASSE*\n\n\uD83D\uDCCD Machine: {machine}\n\uD83D\uDCF1 Client: {phone}\n⭐ Note: {rating}/5\n\uD83D\uDCAC Commentaire: {comment}\n\uD83D\uDD50 Heure: {time}\n\nVeuillez faire un suivi avec le client.");
    }

}
