-- Phase 3 (architecture-review/03-MIGRATION-TODO.md): provision the `bot`
-- schema tables in smartlaundry-dev/smartlaundry-test ahead of cutover.
-- Mirrors spring-bot-manager-only's V1-V5 Flyway migrations
-- (feature/p3-bot-supabase-consolidation), which target the `bot` schema via
-- spring.flyway.schemas=bot.

SET search_path TO bot;

-- V1__core_schema
CREATE TABLE businesses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bot_id VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    industry VARCHAR(50) NOT NULL,
    phone_number_id VARCHAR(50) UNIQUE NOT NULL,
    config JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID REFERENCES businesses(id),
    sender_phone VARCHAR(20) NOT NULL,
    direction VARCHAR(10) NOT NULL,
    message_type VARCHAR(20),
    content TEXT,
    whatsapp_msg_id VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID REFERENCES businesses(id),
    customer_phone VARCHAR(20) NOT NULL,
    provider VARCHAR(20) NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'XAF',
    status VARCHAR(20) NOT NULL,
    provider_ref VARCHAR(100),
    external_ref VARCHAR(100),
    transaction_id VARCHAR(100),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_business ON messages(business_id, created_at DESC);
CREATE INDEX idx_payments_status ON payments(business_id, status);
CREATE INDEX idx_payments_transaction ON payments(transaction_id);
CREATE INDEX idx_payments_external_ref ON payments(external_ref);

-- V2__pharmacy_schema
CREATE TABLE pharmacy_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    description VARCHAR(500),
    price DECIMAL(12,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'XAF',
    stock INTEGER NOT NULL DEFAULT 0,
    category VARCHAR(100),
    requires_prescription BOOLEAN DEFAULT false,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE pharmacy_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES pharmacy_products(id),
    customer_phone VARCHAR(20) NOT NULL,
    quantity INTEGER NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pharmacy_products_name ON pharmacy_products(name);
CREATE INDEX idx_pharmacy_products_category ON pharmacy_products(category);
CREATE INDEX idx_pharmacy_products_active ON pharmacy_products(active, stock);
CREATE INDEX idx_pharmacy_reservations_phone ON pharmacy_reservations(customer_phone, status);
CREATE INDEX idx_pharmacy_reservations_product ON pharmacy_reservations(product_id, status);

-- V3__business_admin_tokens
ALTER TABLE businesses
    ADD COLUMN IF NOT EXISTS verify_token_enc BYTEA,
    ADD COLUMN IF NOT EXISTS access_token_enc BYTEA,
    ADD COLUMN IF NOT EXISTS app_secret_enc BYTEA,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

UPDATE businesses
SET updated_at = COALESCE(updated_at, created_at, NOW())
WHERE updated_at IS NULL;

-- V4__seed_existing_bots
INSERT INTO businesses (bot_id, name, industry, phone_number_id, config, is_active, updated_at)
VALUES (
    'laundry',
    'Smart Laundry',
    'laundry',
    '1089648187567384',
    $$
    {
      "botId": "laundry",
      "botName": "Smart Laundry",
      "botType": "laundry",
      "phoneNumberId": "1089648187567384",
      "mqtt": { "topicPrefix": "laundry" },
      "shortCycle": { "duration": 30, "price": 1000, "pulseCount": 1, "currency": "XAF" },
      "longCycle": { "duration": 60, "price": 2000, "pulseCount": 2, "currency": "XAF" },
      "businessHours": { "openTime": "07:00", "closeTime": "22:00", "closingBufferMinutes": 15, "timezone": "Africa/Douala" },
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
            "language_selection": { "id": "language_selection", "type": "action", "action": "language.show", "next": "await_language" },
            "await_language": { "id": "await_language", "type": "input", "saveAs": "userInput", "next": "process_language" },
            "process_language": { "id": "process_language", "type": "action", "action": "language.process" },
            "main_menu": { "id": "main_menu", "type": "action", "action": "menu.show", "next": "await_menu" },
            "await_menu": { "id": "await_menu", "type": "input", "saveAs": "userInput", "next": "process_menu" },
            "process_menu": { "id": "process_menu", "type": "action", "action": "menu.process" },
            "show_services": { "id": "show_services", "type": "action", "action": "services.show" },
            "machine_method_selection": { "id": "machine_method_selection", "type": "action", "action": "machines.showMethodSelection", "next": "await_machine_method" },
            "await_machine_method": { "id": "await_machine_method", "type": "input", "saveAs": "userInput", "next": "process_machine_method" },
            "process_machine_method": { "id": "process_machine_method", "type": "action", "action": "machines.processMethodSelection" },
            "enter_machine_id": { "id": "enter_machine_id", "type": "action", "action": "machines.showEnterIdPrompt", "next": "await_manual_machine_id" },
            "await_manual_machine_id": { "id": "await_manual_machine_id", "type": "input", "saveAs": "userInput", "next": "process_manual_machine_id" },
            "process_manual_machine_id": { "id": "process_manual_machine_id", "type": "action", "action": "machines.processManualId" },
            "show_machine_list": { "id": "show_machine_list", "type": "action", "action": "machines.showList", "next": "await_machine_selection" },
            "await_machine_selection": { "id": "await_machine_selection", "type": "input", "saveAs": "userInput", "next": "process_machine_selection" },
            "process_machine_selection": { "id": "process_machine_selection", "type": "action", "action": "machines.processListSelection" },
            "cycle_selection": { "id": "cycle_selection", "type": "action", "action": "cycle.show", "next": "await_cycle" },
            "await_cycle": { "id": "await_cycle", "type": "input", "saveAs": "userInput", "next": "process_cycle" },
            "process_cycle": { "id": "process_cycle", "type": "action", "action": "cycle.process" },
            "initiate_payment": { "id": "initiate_payment", "type": "action", "action": "payment.initiate" },
            "show_user_status": { "id": "show_user_status", "type": "action", "action": "status.showUserCycle" },
            "show_availability": { "id": "show_availability", "type": "action", "action": "status.showAvailability" },
            "await_feedback_rating": { "id": "await_feedback_rating", "type": "input", "saveAs": "userInput", "next": "process_feedback_rating" },
            "process_feedback_rating": { "id": "process_feedback_rating", "type": "action", "action": "feedback.processRating" },
            "await_feedback_comment": { "id": "await_feedback_comment", "type": "input", "saveAs": "userInput", "next": "process_feedback_comment" },
            "process_feedback_comment": { "id": "process_feedback_comment", "type": "action", "action": "feedback.processComment" }
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
            "welcome": { "id": "welcome", "type": "buttons", "template": "Bienvenue.\n\n📌 *Service*\nChoisis une option :", "saveAs": "menuChoice", "buttons": [ {"id": "access_network", "title": "🌐 Accès réseau"}, {"id": "pressing", "title": "🧺 Pressing"}, {"id": "help", "title": "❓ Aide"} ], "next": "route_menu" },
            "route_menu": { "id": "route_menu", "type": "action", "action": "menu.route" },
            "pressing_menu": { "id": "pressing_menu", "type": "buttons", "template": "🧺 Pressing\n\nChoisis une option :", "saveAs": "pressingChoice", "buttons": [ {"id": "pressing_machines", "title": "Machines dispo"}, {"id": "pressing_tracking", "title": "Suivi code"}, {"id": "menu", "title": "Menu"} ], "next": "pressing_route_action" },
            "pressing_route_action": { "id": "pressing_route_action", "type": "action", "action": "pressing.route" },
            "pressing_machines_message": { "id": "pressing_machines_message", "type": "message", "template": "🧺 Pressing\n\nMachines disponibles: bientôt.", "next": "pressing_menu" },
            "pressing_tracking_prompt": { "id": "pressing_tracking_prompt", "type": "message", "template": "🏷️ Suivi Pressing\n\nEnvoie ton code pressing (ex: PRS1234) :", "next": "pressing_tracking_input" },
            "pressing_tracking_input": { "id": "pressing_tracking_input", "type": "input", "saveAs": "pressingTrackingCode", "prompt": "Code de suivi", "next": "pressing_tracking_action" },
            "pressing_tracking_action": { "id": "pressing_tracking_action", "type": "action", "action": "pressing.tracking" },
            "pressing_tracking_result": { "id": "pressing_tracking_result", "type": "buttons", "template": "{{{pressingTrackingResult}}}", "saveAs": "pressingChoice", "buttonsFromContext": "pressingButtons", "next": "pressing_route_action" },
            "bandwidth_list_action": { "id": "bandwidth_list_action", "type": "action", "action": "bandwidth.list" },
            "bandwidth_buttons": { "id": "bandwidth_buttons", "type": "buttons", "template": "{{{bandwidthMessage}}}", "buttonsFromContext": "bandwidthButtons", "saveAs": "bandwidthChoiceInput", "next": "bandwidth_validate_action" },
            "bandwidth_validate_action": { "id": "bandwidth_validate_action", "type": "action", "action": "bandwidth.validate" },
            "bandwidth_invalid": { "id": "bandwidth_invalid", "type": "message", "template": "Invalid selection. Please try again.", "next": "bandwidth_list_action" },
            "devices_prompt": { "id": "devices_prompt", "type": "buttons", "template": "📱 *Nombre d'appareils*\nChoisis le nombre d'appareils à connecter :", "saveAs": "deviceCountInput", "buttons": [ {"id": "1", "title": "1 appareil (skip)"}, {"id": "2", "title": "2 appareils"}, {"id": "4", "title": "4 appareils"} ], "next": "devices_calculate_action" },
            "devices_calculate_action": { "id": "devices_calculate_action", "type": "action", "action": "devices.calculate" },
            "devices_invalid": { "id": "devices_invalid", "type": "message", "template": "{{devicesError}}", "next": "devices_prompt" },
            "payment_confirm": { "id": "payment_confirm", "type": "message", "template": "{{{orderSummary}}}", "next": "payment_initiate_action" },
            "payment_initiate_action": { "id": "payment_initiate_action", "type": "action", "action": "payments.initiate" },
            "payment_pending": { "id": "payment_pending", "type": "message", "template": "Payment request sent! Please complete the payment.\n\nYour access code will be sent after payment confirmation." },
            "payment_failed": { "id": "payment_failed", "type": "message", "template": "Payment failed: {{paymentError}}\n\nPlease try again.", "next": "main_menu" },
            "help_message": { "id": "help_message", "type": "message", "template": "Thomas Network Help:\n\n- Choose your bandwidth tier\n- Select number of devices\n- Complete payment\n- Receive your access code\n\nFor support, contact: support@example.com" }
          }
        }
      }
    }
    $$::jsonb,
    true,
    NOW()
)
ON CONFLICT (bot_id) DO NOTHING;

-- V5__add_laundry_reservation_date_time_states
UPDATE businesses
SET config = jsonb_set(
    config,
    '{flows,laundry_flow,states}',
    (config -> 'flows' -> 'laundry_flow' -> 'states') || '{
        "reservation_date": { "id": "reservation_date", "type": "action", "action": "reservation.showDate", "next": "await_reservation_date" },
        "await_reservation_date": { "id": "await_reservation_date", "type": "input", "saveAs": "userInput", "next": "process_reservation_date" },
        "process_reservation_date": { "id": "process_reservation_date", "type": "action", "action": "reservation.processDate" },
        "reservation_time": { "id": "reservation_time", "type": "action", "action": "reservation.showTime", "next": "await_reservation_time" },
        "await_reservation_time": { "id": "await_reservation_time", "type": "input", "saveAs": "userInput", "next": "process_reservation_time" },
        "process_reservation_time": { "id": "process_reservation_time", "type": "action", "action": "reservation.processTime" }
    }'::jsonb
)
WHERE bot_id = 'laundry'
  AND config -> 'flows' -> 'laundry_flow' -> 'states' ? 'reservation_confirm'
  AND NOT (config -> 'flows' -> 'laundry_flow' -> 'states' ? 'reservation_date');

-- Flyway baseline: mark V1-V5 as already applied so the service's Flyway run
-- doesn't try to recreate these objects on first connect.
CREATE TABLE flyway_schema_history (
    installed_rank INT NOT NULL PRIMARY KEY,
    version VARCHAR(50),
    description VARCHAR(200) NOT NULL,
    type VARCHAR(20) NOT NULL,
    script VARCHAR(1000) NOT NULL,
    checksum INT,
    installed_by VARCHAR(100) NOT NULL,
    installed_on TIMESTAMPTZ NOT NULL DEFAULT now(),
    execution_time INT NOT NULL,
    success BOOLEAN NOT NULL
);
CREATE INDEX flyway_schema_history_s_idx ON flyway_schema_history (success);

INSERT INTO flyway_schema_history (installed_rank, version, description, type, script, checksum, installed_by, execution_time, success)
VALUES (1, '5', 'Baseline (manual P2/P3 provisioning)', 'BASELINE', '<< Flyway Baseline >>', NULL, current_user, 0, true);
