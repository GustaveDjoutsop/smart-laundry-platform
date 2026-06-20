/**
 * Translations for WhatsApp Bot
 * Supports English (en) and French (fr)
 */

const translations = {
    // Language selection
    language_prompt: {
        en: "Welcome! Please select your language:",
        fr: "Bienvenue! Veuillez choisir votre langue:"
    },
    language_english: {
        en: "English",
        fr: "English"
    },
    language_french: {
        en: "Français",
        fr: "Français"
    },

    // Main menu
    welcome: {
        en: "Welcome to Smart Laundry! 🧺\nYour unique self-service Laundry!\n\nWhat would you like to do?",
        fr: "Bienvenue chez Smart Laundry! 🧺\nVotre laverie libre-service unique!\n\nQue souhaitez-vous faire?"
    },
    btn_start_wash: {
        en: "🧺 Start a Wash",
        fr: "🧺 Lancer Lavage"
    },
    btn_services: {
        en: "📋 Our Services",
        fr: "📋 Nos Services"
    },
    btn_my_status: {
        en: "📊 My Status",
        fr: "📊 Mon Statut"
    },
    btn_main_menu: {
        en: "🏠 Main Menu",
        fr: "🏠 Menu"
    },
    btn_cancel: {
        en: "❌ Cancel",
        fr: "❌ Annuler"
    },
    btn_try_again: {
        en: "🔄 Try Again",
        fr: "🔄 Réessayer"
    },
    btn_back_menu: {
        en: "🔄 Back to Menu",
        fr: "🔄 Retour Menu"
    },

    // Services menu
    services_title: {
        en: "📋 *Our Services*",
        fr: "📋 *Nos Services*"
    },
    services_washing: {
        en: "🧺 *Washing Programs:*",
        fr: "🧺 *Programmes de Lavage:*"
    },
    services_express: {
        en: "  • Express Wash (30 min) - 2,000 FCFA",
        fr: "  • Lavage Express (30 min) - 2 000 FCFA"
    },
    services_standard: {
        en: "  • Standard Wash (45 min) - 2,500 FCFA",
        fr: "  • Lavage Standard (45 min) - 2 500 FCFA"
    },
    services_intensive: {
        en: "  • Intensive Wash (60 min) - 3,000 FCFA",
        fr: "  • Lavage Intensif (60 min) - 3 000 FCFA"
    },
    services_drying: {
        en: "🔥 *Drying:*\n  • Dryer Usage - 1,000 FCFA",
        fr: "🔥 *Séchage:*\n  • Utilisation Sèche-linge - 1 000 FCFA"
    },
    services_capacity: {
        en: "📏 *Machine Capacity:* 10 kg per load",
        fr: "📏 *Capacité Machine:* 10 kg par charge"
    },
    services_amenities: {
        en: "✨ *Amenities:*\n  • 📶 Free WiFi\n  • ☕ Waiting Area & Café",
        fr: "✨ *Commodités:*\n  • 📶 WiFi Gratuit\n  • ☕ Espace d'Attente & Café"
    },
    services_ready: {
        en: "Ready to get started?",
        fr: "Prêt à commencer?"
    },
    btn_availability: {
        en: "📊 Availability",
        fr: "📊 Disponibilité"
    },

    // Machine selection
    machines_available: {
        en: "🧺 {count} machine(s) available.\n\nHow would you like to select your machine?",
        fr: "🧺 {count} machine(s) disponible(s).\n\nComment souhaitez-vous sélectionner votre machine?"
    },
    no_machines: {
        en: "❌ Sorry, no machines are currently available.\n\nPlease try again later.",
        fr: "❌ Désolé, aucune machine n'est disponible actuellement.\n\nVeuillez réessayer plus tard."
    },
    btn_enter_id: {
        en: "📝 Enter ID",
        fr: "📝 Entrer ID"
    },
    btn_choose_list: {
        en: "📋 Choose List",
        fr: "📋 Voir Liste"
    },
    enter_machine_id: {
        en: "📝 Please type the machine ID or name (e.g., 'washer_01' or 'Washer 1'):\n\n_Type 'cancel' to go back._",
        fr: "📝 Veuillez saisir l'ID ou le nom de la machine (ex: 'washer_01' ou 'Washer 1'):\n\n_Tapez 'cancel' pour revenir._"
    },
    machine_not_found: {
        en: "❌ Machine \"{input}\" not found.\n\nPlease enter a valid machine ID or name.",
        fr: "❌ Machine \"{input}\" introuvable.\n\nVeuillez entrer un ID ou nom de machine valide."
    },
    machine_unavailable: {
        en: "❌ Machine \"{machine}\" is currently not available.\n\nPlease choose another machine.",
        fr: "❌ La machine \"{machine}\" n'est pas disponible actuellement.\n\nVeuillez choisir une autre machine."
    },
    btn_enter_another: {
        en: "📝 Enter Another",
        fr: "📝 Autre ID"
    },
    machine_selected: {
        en: "✅ {machine} is available!\n\nPlease choose your wash cycle:",
        fr: "✅ {machine} est disponible!\n\nVeuillez choisir votre cycle de lavage:"
    },
    machine_just_taken: {
        en: "❌ Sorry, this machine just became unavailable.\n\nPlease choose another machine.",
        fr: "❌ Désolé, cette machine vient d'être prise.\n\nVeuillez choisir une autre machine."
    },
    btn_choose_again: {
        en: "📋 Choose Again",
        fr: "📋 Rechoisir"
    },
    available_machines_title: {
        en: "📋 Available Machines ({count} total):\n\nSelect one:",
        fr: "📋 Machines Disponibles ({count} au total):\n\nSélectionnez-en une:"
    },
    available_machines_more: {
        en: "\n\n_Showing 2 of {count} available. Use \"Enter Machine ID\" to access others._",
        fr: "\n\n_Affichage de 2 sur {count} disponibles. Utilisez \"Entrer ID Machine\" pour les autres._"
    },

    // Cycle selection
    cycle_short: {
        en: "{duration} Min - {price} XAF",
        fr: "{duration} Min - {price} XAF"
    },
    cycle_long: {
        en: "{duration} Min - {price} XAF",
        fr: "{duration} Min - {price} XAF"
    },

    // Payment
    payment_initiating: {
        en: "⏳ Initiating payment...\n\n📍 Machine: {machine}\n⏱️ Duration: {duration} minutes\n💰 Amount: {amount} XAF\n\nPlease check your phone to approve the payment.",
        fr: "⏳ Initialisation du paiement...\n\n📍 Machine: {machine}\n⏱️ Durée: {duration} minutes\n💰 Montant: {amount} XAF\n\nVeuillez vérifier votre téléphone pour approuver le paiement."
    },
    payment_success: {
        en: "✅ Payment prompt sent!\n\nPlease enter your PIN on your phone. The machine will start automatically once payment is confirmed.\n\nType 'start' for a new transaction.",
        fr: "✅ Demande de paiement envoyée!\n\nVeuillez entrer votre PIN sur votre téléphone. La machine démarrera automatiquement une fois le paiement confirmé.\n\nTapez 'start' pour une nouvelle transaction."
    },
    payment_failed: {
        en: "❌ {error}",
        fr: "❌ {error}"
    },
    session_error: {
        en: "❌ Something went wrong. Please type 'start' to begin again.",
        fr: "❌ Une erreur s'est produite. Veuillez taper 'start' pour recommencer."
    },

    // Status
    status_active: {
        en: "🔄 Your Wash Status:\n\n📍 Machine: {machine}\n⏱️ Time Remaining: {minutes} minute(s)\n💰 Paid: {amount} XAF\n\nYour laundry will be ready soon!",
        fr: "🔄 Statut de votre Lavage:\n\n📍 Machine: {machine}\n⏱️ Temps Restant: {minutes} minute(s)\n💰 Payé: {amount} XAF\n\nVotre linge sera bientôt prêt!"
    },
    status_none: {
        en: "ℹ️ You don't have any active wash cycle at the moment.\n\nWould you like to start one?",
        fr: "ℹ️ Vous n'avez aucun cycle de lavage actif pour le moment.\n\nSouhaitez-vous en démarrer un?"
    },

    // Availability
    availability_title: {
        en: "📊 Machine Availability:",
        fr: "📊 Disponibilité des Machines:"
    },
    availability_available: {
        en: "✅ Available:",
        fr: "✅ Disponibles:"
    },
    availability_none: {
        en: "✅ Available: None",
        fr: "✅ Disponibles: Aucune"
    },
    availability_in_use: {
        en: "🔄 In Use:",
        fr: "🔄 En Cours:"
    },
    availability_more_available: {
        en: "  _...and {count} more available_",
        fr: "  _...et {count} autre(s) disponible(s)_"
    },
    availability_more_in_use: {
        en: "  _...and {count} more in use_",
        fr: "  _...et {count} autre(s) en cours_"
    },
    availability_total: {
        en: "📈 Total: {available} available, {inUse} in use",
        fr: "📈 Total: {available} disponible(s), {inUse} en cours"
    },
    machine_available_icon: {
        en: "  🟢 {name}",
        fr: "  🟢 {name}"
    },
    machine_in_use_icon: {
        en: "  🔴 {name} ({minutes} min left)",
        fr: "  🔴 {name} ({minutes} min restantes)"
    },

    // Errors
    not_understood: {
        en: "Sorry, I didn't understand that.\n\nType 'start' or press the button below to see the main menu.",
        fr: "Désolé, je n'ai pas compris.\n\nTapez 'start' ou appuyez sur le bouton ci-dessous pour voir le menu principal."
    },

    // Payment confirmation (sent after webhook)
    payment_confirmed: {
        en: "✅ *Payment Confirmed!*\n\n💰 Amount: {amount} XAF\n📍 Machine: {machine}\n⏱️ Duration: {duration} minutes\n\n🚀 *The machine is now ready!*\nPlease close the door and press START to begin your wash cycle.\n\n⏰ Your cycle ends at: {endTime}",
        fr: "✅ *Paiement Confirmé!*\n\n💰 Montant: {amount} XAF\n📍 Machine: {machine}\n⏱️ Durée: {duration} minutes\n\n🚀 *La machine est prête!*\nVeuillez fermer la porte et appuyer sur START pour démarrer votre cycle.\n\n⏰ Fin du cycle à: {endTime}"
    },
    payment_failed_notification: {
        en: "❌ *Payment Failed*\n\nYour payment for {machine} was not completed.\n\n📋 Reason: {reason}\n\nPlease try again or contact support if the problem persists.",
        fr: "❌ *Paiement Échoué*\n\nVotre paiement pour {machine} n'a pas abouti.\n\n📋 Raison: {reason}\n\nVeuillez réessayer ou contacter le support si le problème persiste."
    },

    // Cycle completion notification
    cycle_completed: {
        en: "🎉 *Your laundry is ready!*\n\n📍 Machine: {machine}\n⏱️ Cycle completed at: {endTime}\n\n👕 Please collect your clothes so the next customer can use the machine.\n\nThank you for using Smart Laundry! 🧺",
        fr: "🎉 *Votre linge est prêt!*\n\n📍 Machine: {machine}\n⏱️ Cycle terminé à: {endTime}\n\n👕 Veuillez récupérer vos vêtements pour que le prochain client puisse utiliser la machine.\n\nMerci d'avoir utilisé Smart Laundry! 🧺"
    },

    // Feedback request (sent 30 min after cycle completion)
    feedback_request: {
        en: "⭐ *How was your experience?*\n\n📍 Machine: {machine}\n\nPlease rate your wash cycle:",
        fr: "⭐ *Comment était votre expérience?*\n\n📍 Machine: {machine}\n\nVeuillez noter votre cycle de lavage:"
    },
    btn_rating_5: {
        en: "⭐⭐⭐⭐⭐ Excellent",
        fr: "⭐⭐⭐⭐⭐ Excellent"
    },
    btn_rating_4: {
        en: "⭐⭐⭐⭐ Good",
        fr: "⭐⭐⭐⭐ Bien"
    },
    btn_rating_3: {
        en: "⭐⭐⭐ Average",
        fr: "⭐⭐⭐ Moyen"
    },
    btn_rating_2: {
        en: "⭐⭐ Poor",
        fr: "⭐⭐ Médiocre"
    },
    btn_rating_1: {
        en: "⭐ Very Poor",
        fr: "⭐ Très Mauvais"
    },
    feedback_thanks_high: {
        en: "🙏 *Thank you for your feedback!*\n\nWe're glad you had a great experience. See you next time! 🧺",
        fr: "🙏 *Merci pour votre avis!*\n\nNous sommes ravis que vous ayez passé un bon moment. À bientôt! 🧺"
    },
    feedback_thanks_low: {
        en: "🙏 *Thank you for your feedback.*\n\nPlease tell us how we can improve your experience.\n\n📝 *Write your comment* (max 100 words)\n\n_Or type 'skip' to continue without comment._",
        fr: "🙏 *Merci pour votre avis.*\n\nDites-nous comment nous pouvons améliorer votre expérience.\n\n📝 *Écrivez votre commentaire* (max 100 mots)\n\n_Ou tapez 'passer' pour continuer sans commentaire._"
    },
    feedback_comment_received: {
        en: "📝 *Comment received.*\n\nOur team will review your feedback. Thank you for helping us improve!\n\nType 'start' to begin a new wash.",
        fr: "📝 *Commentaire reçu.*\n\nNotre équipe examinera votre avis. Merci de nous aider à nous améliorer!\n\nTapez 'start' pour démarrer un nouveau lavage."
    },
    feedback_skipped: {
        en: "👍 No problem! Thank you for your rating.\n\nType 'start' to begin a new wash.",
        fr: "👍 Pas de problème! Merci pour votre note.\n\nTapez 'start' pour démarrer un nouveau lavage."
    },
    feedback_comment_too_long: {
        en: "⚠️ Your comment is too long ({words} words). Please keep it under 100 words.\n\n_Or type 'skip' to continue without comment._",
        fr: "⚠️ Votre commentaire est trop long ({words} mots). Veuillez le limiter à 100 mots.\n\n_Ou tapez 'passer' pour continuer sans commentaire._"
    },

    // Payment failure reasons (from Campay/MTN webhooks)
    failure_reason_cancelled: {
        en: "Payment was cancelled by user",
        fr: "Paiement annulé par l'utilisateur"
    },
    failure_reason_timeout: {
        en: "Payment request timed out",
        fr: "Délai de paiement expiré"
    },
    failure_reason_insufficient_funds: {
        en: "Insufficient balance in your account",
        fr: "Solde insuffisant sur votre compte"
    },
    failure_reason_declined: {
        en: "Payment was declined",
        fr: "Paiement refusé"
    },
    failure_reason_unknown: {
        en: "Unknown error",
        fr: "Erreur inconnue"
    },

    // Staff alert for low ratings
    staff_alert_low_rating: {
        en: "⚠️ *LOW RATING ALERT*\n\n📍 Machine: {machine}\n📱 Customer: {phone}\n⭐ Rating: {rating}/5\n💬 Comment: {comment}\n🕐 Time: {time}\n\nPlease follow up with the customer.",
        fr: "⚠️ *ALERTE NOTE BASSE*\n\n📍 Machine: {machine}\n📱 Client: {phone}\n⭐ Note: {rating}/5\n💬 Commentaire: {comment}\n🕐 Heure: {time}\n\nVeuillez faire un suivi avec le client."
    },

    // Race condition - machine claimed by another user
    machine_already_taken_refund: {
        en: "❌ *Machine Already Taken*\n\n📍 Machine: {machine}\n\nSorry, another customer completed payment for this machine just before you.\n\n💰 Your payment will be refunded automatically.\n\nPlease select a different machine or try again.",
        fr: "❌ *Machine Déjà Prise*\n\n📍 Machine: {machine}\n\nDésolé, un autre client a finalisé le paiement pour cette machine juste avant vous.\n\n💰 Votre paiement sera remboursé automatiquement.\n\nVeuillez sélectionner une autre machine ou réessayer."
    },

    // Business hours messages
    closed_before_opening: {
        en: "🚫 *We're currently closed*\n\n🕐 Our opening hours:\n📍 Open: {openTime}\n📍 Close: {closeTime}\n\nPlease come back during our business hours!",
        fr: "🚫 *Nous sommes actuellement fermés*\n\n🕐 Nos horaires d'ouverture:\n📍 Ouverture: {openTime}\n📍 Fermeture: {closeTime}\n\nRevenez pendant nos heures d'ouverture!"
    },
    closed_after_closing: {
        en: "🚫 *We're closed for today*\n\n🕐 Our opening hours:\n📍 Open: {openTime}\n📍 Close: {closeTime}\n\nSee you tomorrow!",
        fr: "🚫 *Nous sommes fermés pour aujourd'hui*\n\n🕐 Nos horaires d'ouverture:\n📍 Ouverture: {openTime}\n📍 Fermeture: {closeTime}\n\nÀ demain!"
    },
    cycle_too_late: {
        en: "⏰ *Too late for this cycle*\n\nWe close at {closeTime} and a {duration}-minute cycle would finish too late.\n\n🕐 Current time: {currentTime}\n⏱️ Last start time for this cycle: {lastAllowedTime}\n\nPlease choose a shorter cycle or come back tomorrow!",
        fr: "⏰ *Trop tard pour ce cycle*\n\nNous fermons à {closeTime} et un cycle de {duration} minutes se terminerait trop tard.\n\n🕐 Heure actuelle: {currentTime}\n⏱️ Dernière heure de démarrage pour ce cycle: {lastAllowedTime}\n\nVeuillez choisir un cycle plus court ou revenir demain!"
    },
    cycle_too_late_all: {
        en: "⏰ *We're closing soon*\n\nWe close at {closeTime} and there's not enough time for any wash cycle.\n\n🕐 Current time: {currentTime}\n\nPlease come back tomorrow during our business hours:\n📍 Open: {openTime}\n📍 Close: {closeTime}",
        fr: "⏰ *Nous fermons bientôt*\n\nNous fermons à {closeTime} et il n'y a pas assez de temps pour un cycle de lavage.\n\n🕐 Heure actuelle: {currentTime}\n\nRevenez demain pendant nos heures d'ouverture:\n📍 Ouverture: {openTime}\n📍 Fermeture: {closeTime}"
    },

    // Payment timeout notification
    payment_timeout_expired: {
        en: "⏰ *Payment Expired*\n\n📍 Machine: {machine}\n\nYour payment was not completed within 5 minutes. The machine is now available for others.\n\nWould you like to try again?",
        fr: "⏰ *Paiement Expiré*\n\n📍 Machine: {machine}\n\nVotre paiement n'a pas été effectué dans les 5 minutes. La machine est maintenant disponible pour les autres.\n\nVoulez-vous réessayer?"
    }
};

module.exports = translations;
