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

## Architecture references

See `docs/architecture/` for ADRs + PRD that guide this repo structure.

## Requirements

- ThomasNetworkBot – Pressing service: [docs/requirements/thomas-network-pressing.md](docs/requirements/thomas-network-pressing.md)
