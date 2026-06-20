-- Seed the existing laundry bot structure without secrets.
-- Tokens should be configured later through the Admin API after deployment.

INSERT INTO businesses (bot_id, name, industry, phone_number_id, config, is_active, updated_at)
VALUES (
    'laundry',
    'Smart Laundry',
    'laundry',
    '954151401109786',
    $$
    {
      "botId": "laundry",
      "botName": "Smart Laundry",
      "botType": "laundry",
      "phoneNumberId": "954151401109786",
      "mqtt": {
        "topicPrefix": "laundry"
      },
      "shortCycle": {
        "duration": 30,
        "price": 1000,
        "pulseCount": 1,
        "currency": "XAF"
      },
      "longCycle": {
        "duration": 60,
        "price": 2000,
        "pulseCount": 2,
        "currency": "XAF"
      },
      "businessHours": {
        "openTime": "07:00",
        "closeTime": "22:00",
        "closingBufferMinutes": 15,
        "timezone": "Africa/Douala"
      },
      "staffAlertPhone": "237600000000",
      "machines": [
        { "id": "washer_01", "type": "WASHER", "name": "Washer 1" },
        { "id": "washer_02", "type": "WASHER", "name": "Washer 2" },
        { "id": "washer_03", "type": "WASHER", "name": "Washer 3" },
        { "id": "dryer_01", "type": "DRYER", "name": "Dryer 1" }
      ],
      "availableMachineIds": ["washer_01", "washer_02", "washer_03", "dryer_01"],
      "defaultFlowId": "laundry_flow",
      "flows": {
        "laundry_flow": {
          "id": "laundry_flow",
          "triggers": ["hi", "hello", "reset", "cancel", "stop", "start"],
          "startState": "language_selection",
          "states": {
            "language_selection": {
              "id": "language_selection",
              "type": "action",
              "action": "language.show",
              "next": "await_language"
            },
            "await_language": {
              "id": "await_language",
              "type": "input",
              "saveAs": "userInput",
              "next": "process_language"
            },
            "process_language": {
              "id": "process_language",
              "type": "action",
              "action": "language.process"
            },
            "main_menu": {
              "id": "main_menu",
              "type": "action",
              "action": "menu.show",
              "next": "await_menu"
            },
            "await_menu": {
              "id": "await_menu",
              "type": "input",
              "saveAs": "userInput",
              "next": "process_menu"
            },
            "process_menu": {
              "id": "process_menu",
              "type": "action",
              "action": "menu.process"
            },
            "show_services": {
              "id": "show_services",
              "type": "action",
              "action": "services.show"
            },
            "machine_method_selection": {
              "id": "machine_method_selection",
              "type": "action",
              "action": "machines.showMethodSelection",
              "next": "await_machine_method"
            },
            "await_machine_method": {
              "id": "await_machine_method",
              "type": "input",
              "saveAs": "userInput",
              "next": "process_machine_method"
            },
            "process_machine_method": {
              "id": "process_machine_method",
              "type": "action",
              "action": "machines.processMethodSelection"
            },
            "enter_machine_id": {
              "id": "enter_machine_id",
              "type": "action",
              "action": "machines.showEnterIdPrompt",
              "next": "await_manual_machine_id"
            },
            "await_manual_machine_id": {
              "id": "await_manual_machine_id",
              "type": "input",
              "saveAs": "userInput",
              "next": "process_manual_machine_id"
            },
            "process_manual_machine_id": {
              "id": "process_manual_machine_id",
              "type": "action",
              "action": "machines.processManualId"
            },
            "show_machine_list": {
              "id": "show_machine_list",
              "type": "action",
              "action": "machines.showList",
              "next": "await_machine_selection"
            },
            "await_machine_selection": {
              "id": "await_machine_selection",
              "type": "input",
              "saveAs": "userInput",
              "next": "process_machine_selection"
            },
            "process_machine_selection": {
              "id": "process_machine_selection",
              "type": "action",
              "action": "machines.processListSelection"
            },
            "cycle_selection": {
              "id": "cycle_selection",
              "type": "action",
              "action": "cycle.show",
              "next": "await_cycle"
            },
            "await_cycle": {
              "id": "await_cycle",
              "type": "input",
              "saveAs": "userInput",
              "next": "process_cycle"
            },
            "process_cycle": {
              "id": "process_cycle",
              "type": "action",
              "action": "cycle.process"
            },
            "initiate_payment": {
              "id": "initiate_payment",
              "type": "action",
              "action": "payment.initiate"
            },
            "show_user_status": {
              "id": "show_user_status",
              "type": "action",
              "action": "status.showUserCycle"
            },
            "show_availability": {
              "id": "show_availability",
              "type": "action",
              "action": "status.showAvailability"
            },
            "await_feedback_rating": {
              "id": "await_feedback_rating",
              "type": "input",
              "saveAs": "userInput",
              "next": "process_feedback_rating"
            },
            "process_feedback_rating": {
              "id": "process_feedback_rating",
              "type": "action",
              "action": "feedback.processRating"
            },
            "await_feedback_comment": {
              "id": "await_feedback_comment",
              "type": "input",
              "saveAs": "userInput",
              "next": "process_feedback_comment"
            },
            "process_feedback_comment": {
              "id": "process_feedback_comment",
              "type": "action",
              "action": "feedback.processComment"
            }
          }
        }
      }
    }
    $$::jsonb,
    true,
    NOW()
)
ON CONFLICT (bot_id) DO NOTHING;

INSERT INTO businesses (bot_id, name, industry, phone_number_id, config, is_active, updated_at)
VALUES (
    'thomasnetwork',
    'Thomas Network Access',
    'thomas_network',
    '1030993210090797',
    $$
    {
      "botId": "thomasnetwork",
      "botName": "Thomas Network Access",
      "botType": "thomas_network",
      "phoneNumberId": "1030993210090797",
      "defaultFlowId": "main_menu",
      "flows": {
        "main_menu": {
          "id": "main_menu",
          "triggers": ["hi", "hello", "menu", "start"],
          "startState": "welcome",
          "states": {
            "welcome": {
              "id": "welcome",
              "type": "buttons",
              "template": "Bienvenue.\n\n📌 *Service*\nChoisis une option :",
              "saveAs": "menuChoice",
              "buttons": [
                {"id": "access_network", "title": "🌐 Accès réseau"},
                {"id": "pressing", "title": "🧺 Pressing"},
                {"id": "help", "title": "❓ Aide"}
              ],
              "next": "route_menu"
            },
            "route_menu": {
              "id": "route_menu",
              "type": "action",
              "action": "menu.route"
            },
            "pressing_menu": {
              "id": "pressing_menu",
              "type": "buttons",
              "template": "🧺 Pressing\n\nChoisis une option :",
              "saveAs": "pressingChoice",
              "buttons": [
                {"id": "pressing_machines", "title": "Machines dispo"},
                {"id": "pressing_tracking", "title": "Suivi code"},
                {"id": "menu", "title": "Menu"}
              ],
              "next": "pressing_route_action"
            },
            "pressing_route_action": {
              "id": "pressing_route_action",
              "type": "action",
              "action": "pressing.route"
            },
            "pressing_machines_message": {
              "id": "pressing_machines_message",
              "type": "message",
              "template": "🧺 Pressing\n\nMachines disponibles: bientôt.",
              "next": "pressing_menu"
            },
            "pressing_tracking_prompt": {
              "id": "pressing_tracking_prompt",
              "type": "message",
              "template": "🏷️ Suivi Pressing\n\nEnvoie ton code pressing (ex: PRS1234) :",
              "next": "pressing_tracking_input"
            },
            "pressing_tracking_input": {
              "id": "pressing_tracking_input",
              "type": "input",
              "saveAs": "pressingTrackingCode",
              "prompt": "Code de suivi",
              "next": "pressing_tracking_action"
            },
            "pressing_tracking_action": {
              "id": "pressing_tracking_action",
              "type": "action",
              "action": "pressing.tracking"
            },
            "pressing_tracking_result": {
              "id": "pressing_tracking_result",
              "type": "buttons",
              "template": "{{{pressingTrackingResult}}}",
              "saveAs": "pressingChoice",
              "buttonsFromContext": "pressingButtons",
              "next": "pressing_route_action"
            },
            "bandwidth_list_action": {
              "id": "bandwidth_list_action",
              "type": "action",
              "action": "bandwidth.list"
            },
            "bandwidth_buttons": {
              "id": "bandwidth_buttons",
              "type": "buttons",
              "template": "{{{bandwidthMessage}}}",
              "buttonsFromContext": "bandwidthButtons",
              "saveAs": "bandwidthChoiceInput",
              "next": "bandwidth_validate_action"
            },
            "bandwidth_validate_action": {
              "id": "bandwidth_validate_action",
              "type": "action",
              "action": "bandwidth.validate"
            },
            "bandwidth_invalid": {
              "id": "bandwidth_invalid",
              "type": "message",
              "template": "Invalid selection. Please try again.",
              "next": "bandwidth_list_action"
            },
            "devices_prompt": {
              "id": "devices_prompt",
              "type": "buttons",
              "template": "📱 *Nombre d'appareils*\nChoisis le nombre d'appareils à connecter :",
              "saveAs": "deviceCountInput",
              "buttons": [
                {"id": "1", "title": "1 appareil (skip)"},
                {"id": "2", "title": "2 appareils"},
                {"id": "4", "title": "4 appareils"}
              ],
              "next": "devices_calculate_action"
            },
            "devices_calculate_action": {
              "id": "devices_calculate_action",
              "type": "action",
              "action": "devices.calculate"
            },
            "devices_invalid": {
              "id": "devices_invalid",
              "type": "message",
              "template": "{{devicesError}}",
              "next": "devices_prompt"
            },
            "payment_confirm": {
              "id": "payment_confirm",
              "type": "message",
              "template": "{{{orderSummary}}}",
              "next": "payment_initiate_action"
            },
            "payment_initiate_action": {
              "id": "payment_initiate_action",
              "type": "action",
              "action": "payments.initiate"
            },
            "payment_pending": {
              "id": "payment_pending",
              "type": "message",
              "template": "Payment request sent! Please complete the payment.\n\nYour access code will be sent after payment confirmation."
            },
            "payment_failed": {
              "id": "payment_failed",
              "type": "message",
              "template": "Payment failed: {{paymentError}}\n\nPlease try again.",
              "next": "main_menu"
            },
            "help_message": {
              "id": "help_message",
              "type": "message",
              "template": "Thomas Network Help:\n\n- Choose your bandwidth tier\n- Select number of devices\n- Complete payment\n- Receive your access code\n\nFor support, contact: support@example.com"
            }
          }
        }
      }
    }
    $$::jsonb,
    true,
    NOW()
)
ON CONFLICT (bot_id) DO NOTHING;