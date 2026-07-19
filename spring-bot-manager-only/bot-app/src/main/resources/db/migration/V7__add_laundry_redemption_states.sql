-- Root-cause fix for "I have a Code" resetting to language selection.
--
-- The reservation-redemption feature (bot-laundry LaundryFlowPlugin's
-- enter_reservation_code/await_reservation_code/process_reservation_code
-- states, action_redeem row) shipped in code and unit tests, but its new
-- states were never merged into the `businesses` table's stored flow --
-- only configs/bots/laundry.bot.json was updated. Since BotRegistry.init()
-- loads the flow from the DB whenever an active `businesses` row exists
-- (see V6's identical "Reserve -> language selection" root cause), the
-- production flow never had these three states.
--
-- When a customer selects "J'ai un Code" / action_redeem, the plugin does
-- goTo("enter_reservation_code"). The FlowEngine can't find that state in
-- the stored flow, so it resets currentStateId and falls back to the
-- flow's startState (language_selection) -- confirmed live in Railway logs:
-- "State enter_reservation_code not found in flow laundry_flow. Resetting
-- to startState language_selection" (2026-07-12).
--
-- This migration merges the three redemption states into the stored flow,
-- mirroring configs/bots/laundry.bot.json. Idempotent, same as V6: `||`
-- adds missing keys and overwrites any existing ones with the canonical
-- definition.
--
-- Guarded with COALESCE (V6 did not have this): jsonb_set is strict, so if
-- the states path were ever absent for a matched row, the bare `existing ||
-- patch` would evaluate to NULL and jsonb_set would blow away the ENTIRE
-- config column for that business, not just skip the patch. COALESCE to an
-- empty object makes a missing path add the patch instead of nulling the row.
UPDATE businesses
SET config = jsonb_set(
    config,
    '{flows,laundry_flow,states}',
    COALESCE(config -> 'flows' -> 'laundry_flow' -> 'states', '{}'::jsonb) || '{
        "enter_reservation_code": {
            "id": "enter_reservation_code",
            "type": "action",
            "action": "reservation.showRedeemPrompt",
            "next": "await_reservation_code"
        },
        "await_reservation_code": {
            "id": "await_reservation_code",
            "type": "input",
            "saveAs": "userInput",
            "next": "process_reservation_code"
        },
        "process_reservation_code": {
            "id": "process_reservation_code",
            "type": "action",
            "action": "reservation.processRedeemCode"
        }
    }'::jsonb
)
WHERE bot_id = 'laundry';
