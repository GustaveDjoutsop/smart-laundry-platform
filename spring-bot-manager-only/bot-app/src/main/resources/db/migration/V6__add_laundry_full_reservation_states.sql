-- Root-cause fix for the "Reserve → language selection" bug.
--
-- The laundry_flow stored in the `businesses` table (seeded by V4) never contained
-- ANY reservation states. V5 tried to add the date/time states but guarded its UPDATE
-- on `reservation_confirm` already existing — which it never did in the seed — so V5
-- was a silent no-op. As a result the DB flow is missing every reservation state.
--
-- When a user taps "Reserve", the plugin does goTo("reservation_date"). The FlowEngine
-- cannot find that state in the flow, so it resets currentStateId and falls back to the
-- flow's startState (language_selection) — sending the user back to language selection.
--
-- This migration merges the COMPLETE reservation state set (date, time, confirm and
-- initiate, plus their await/process counterparts) into the stored flow. It is
-- idempotent: the `||` operator adds missing keys and overwrites any existing ones with
-- the canonical definition, so it is safe to run regardless of the flow's current state.
-- The definitions mirror configs/bots/laundry.bot.json, the source of truth in code.
UPDATE businesses
SET config = jsonb_set(
    config,
    '{flows,laundry_flow,states}',
    (config -> 'flows' -> 'laundry_flow' -> 'states') || '{
        "reservation_date": {
            "id": "reservation_date",
            "type": "action",
            "action": "reservation.showDate",
            "next": "await_reservation_date"
        },
        "await_reservation_date": {
            "id": "await_reservation_date",
            "type": "input",
            "saveAs": "userInput",
            "next": "process_reservation_date"
        },
        "process_reservation_date": {
            "id": "process_reservation_date",
            "type": "action",
            "action": "reservation.processDate"
        },
        "reservation_time": {
            "id": "reservation_time",
            "type": "action",
            "action": "reservation.showTime",
            "next": "await_reservation_time"
        },
        "await_reservation_time": {
            "id": "await_reservation_time",
            "type": "input",
            "saveAs": "userInput",
            "next": "process_reservation_time"
        },
        "process_reservation_time": {
            "id": "process_reservation_time",
            "type": "action",
            "action": "reservation.processTime"
        },
        "reservation_confirm": {
            "id": "reservation_confirm",
            "type": "action",
            "action": "reservation.confirm",
            "next": "await_reservation_confirm"
        },
        "await_reservation_confirm": {
            "id": "await_reservation_confirm",
            "type": "input",
            "saveAs": "userInput",
            "next": "process_reservation_confirm"
        },
        "process_reservation_confirm": {
            "id": "process_reservation_confirm",
            "type": "action",
            "action": "reservation.processConfirm"
        },
        "initiate_reservation": {
            "id": "initiate_reservation",
            "type": "action",
            "action": "reservation.initiate"
        }
    }'::jsonb
)
WHERE bot_id = 'laundry';
