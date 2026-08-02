# Requirement: ThomasNetworkBot – Pressing service

## Goal
Add a second service to the ThomasNetworkBot WhatsApp menu:
- Existing: **Accès réseau** (network access)
- New: **Pressing**

The **Pressing** service must allow users to:
1) Check washer availability (now vs next available)
2) Check whether their clothes are ready by providing a **pressing code**

## UX (WhatsApp)
- Entry: user types `hi` / `bonjour` / `menu` → service menu (interactive reply buttons)
- Service menu buttons:
  - `1` → 🌐 Accès réseau
  - `2` → 🧺 Pressing

### Pressing menu
Interactive reply buttons:
- 🧺 Disponibilité machines
- 🏷️ Suivi pressing
- ⬅️ Menu

### Washer availability
When the user selects **Disponibilité machines**:
- If at least one washer is `AVAILABLE` → respond with “you have a washer available” + list the available washer IDs.
- Else, if washers are `IN_USE` and have `remainingSeconds` → respond with “next washer available in ~X”.
- Else → respond that availability cannot be determined.

Data source:
- Reads machine status from Redis via `MachineStore` using the `laundry` bot machine records.
- Laundry bot ID can be overridden with `PRESSING_LAUNDRY_BOT_ID` (default: `laundry`).

### Pressing code tracking
When the user selects **Suivi pressing**:
- Ask for a pressing code (example: `PRS123`).
- Lookup order status in Redis.
- If `status=READY` OR `readyAt <= now` → respond: “✅ ready”.
- If `readyAt > now` → respond with an ETA.
- If not found → respond that the code is unknown.

Redis key format:
- `pressingOrder:<botId>:<CODE>`
  - `<botId>` is the ThomasNetwork bot id (default: `thomas_network`)
  - `<CODE>` uppercased

Record JSON shape (stored as the value):
```json
{
  "code": "PRS123",
  "status": "IN_PROGRESS",
  "readyAt": "2026-02-05T18:30:00.000Z"
}
```

## Implementation notes
- Config: [configs/bots/thomasNetwork.bot.json](../../configs/bots/thomasNetwork.bot.json)
- Logic: [src/bots/thomasNetwork/thomasNetworkFlowPlugin.js](../../src/bots/thomasNetwork/thomasNetworkFlowPlugin.js)
- Tests: [test/thomasNetworkFlow.test.js](../../test/thomasNetworkFlow.test.js)

## Non-goals (for now)
- Creating/issuing pressing codes automatically.
- Staff/admin UI for managing pressing orders (orders can be seeded/updated directly in Redis).
