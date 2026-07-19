# BotManagerService

Node.js/Express **modular monolith** service for a multi-tenant Bot-as-a-Service platform (WhatsApp Cloud API), with:
- Multi-bot routing via `phone_number_id`
- Configuration-driven conversation flows (JSON)
- Redis-backed state (with in-memory fallback for graceful degradation)
- Payment provider abstraction (CamPay/MTN MoMo stubs)
- MQTT integration points for IoT machine control

## Quick start

1. Install deps:
   - `npm install`
2. Configure:
   - Copy `.env.example` to `.env` and set values
3. Run:
   - `npm run dev`

## Endpoints

- `GET /api/health`  health check
- `GET /api/whatsapp/webhook`  Meta verification endpoint
- `POST /api/whatsapp/webhook`  WhatsApp inbound messages

## Adding a new bot (no code required)

Any business without custom integrations runs as a pure configuration-driven bot:

1. Create `configs/bots/<name>.bot.json` with `botId`, a unique `phoneNumberId` + `verifyToken` (from the Meta app), `defaultFlowId` and `flows`. Don't commit real tokens: bot configs support `${VAR}` env placeholders (e.g. `"verifyToken": "${META_VERIFY_TOKEN_AFROMARKET}"`).
2. Set `WHATSAPP_ACCESS_TOKEN_<BOTID_UPPERCASE>` (plus any `${VAR}` placeholders used in the config) in the environment.
3. Restart the service — the registry registers unknown `botType`s as a generic `ConfigBot`.

Flow state types: `message` (text, then stop), `image` (media with caption; with `next` it continues so a follow-up menu renders in the same turn), `buttons` / `list` (interactive prompts, `saveAs` stores the reply), `input` (free text), `action` (built-ins `set` and `route`; anything else needs a plugin).

Branching is config-driven via the `route` action:

```json
{
  "id": "menu_route",
  "type": "action",
  "action": "route",
  "params": {
    "from": "menuChoice",
    "map": { "browse_recipes": "region_menu" },
    "default": "welcome"
  }
}
```

Bots that need custom behavior (payments, MQTT, machine state) extend `ConfigBot` with a `FlowPlugin` — see `src/bots/laundry` and `src/bots/thomasNetwork`.

## Architecture references

See `docs/architecture/` for ADRs + PRD that guide this repo structure.

## Requirements

- ThomasNetworkBot – Pressing service: [docs/requirements/thomas-network-pressing.md](docs/requirements/thomas-network-pressing.md)
- AfroMarket – recipes & meal plans bot: [docs/requirements/afromarket.md](docs/requirements/afromarket.md)
