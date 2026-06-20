# Codierung Workspace — Gustave (Sunday) Djoutsop

## Who I Am / Business Context
Solo entrepreneur in Douala, Cameroon, building two interconnected ventures:

1. **Smart Self-Service Laundromat** — likely first automated laundromat in Douala.
   Customers interact via WhatsApp to pay (MTN MoMo, Orange Money, CamPay) and
   remotely trigger washing machines. Machines controlled via RS485/Modbus from
   a Raspberry Pi edge node connected to a Spring Boot backend.

2. **Smart Bot Platform** — a service company that builds and operates custom
   WhatsApp bots for multiple business clients (pharmacies, healthcare,
   restaurants...). The laundromat is the flagship proof-of-concept and first
   production tenant.

## Repository Map
- `spring-bot-manager/` — Spring Boot 3.2.2 / Java 17 monorepo (Heroku, PostgreSQL,
  Redis). Core multi-bot backend. See `spring-bot-manager/CLAUDE.md`.
  GitHub: `GustaveDjoutsop/spring-bot-manager`
- `laundry-esp32/` — Arduino/ESP32 firmware for edge hardware (legacy/alternate
  edge path; primary edge target is Raspberry Pi 4 + RS485).
- Hardware/procurement docs (Modbus register maps, supplier comms, electrical
  specs) live in project Notion: `MultibotService > 📁 Documentation`, not in repos.

## Global Conventions
- **English only** in all supplier-facing communication (Alice, Mary, etc.) —
  written messages, specs, questions.
- **Validate protocol/spec documents before committing money.** Never proceed
  to a deposit without the relevant Modbus register map / API doc in hand.
- **Don't wait for hardware to start coding.** If a register map / spec is
  confirmed, build and test against it immediately.
- **Security credential hygiene is non-negotiable**: no tokens/secrets in Git,
  ever. AES-256-GCM encrypted token storage + admin refresh endpoint pattern,
  not GitHub Secrets (requires redeploy) and not a UI dashboard (premature).
- **MQTT must use TLS** (`ssl://`, port 8883) — never plain `tcp://` 1883.
- **80% of bot behavior should be config-driven JSON**, not hardcoded logic —
  this is what lets new clients onboard without code changes.
- Architecture decisions get written as ADRs and saved to Notion under
  `MultibotService > 📁 Documentation` (ADR-005–007 exist so far).
- Feature work happens on feature branches with CI/CD on GitHub. One logical
  step = one commit, in execution order — don't combine refactor steps.

## Current Focus
- **Laundromat hardware**: Alice (XGQ washers / HG dryers) is the selected
  supplier — Modbus register 4X1150 enables remote program selection, which
  Mary's EQ-LINK system cannot do. Open items: (1) get dryer protocol doc
  SX274003A from Alice, (2) clarify register 4X1149 behavior in non-coin mode.
  Next: start `ModbusWasherClient.java` against confirmed register map
  (don't wait for the ~50-day delivery).
- **Backend**: `spring-bot-manager` — Smart Laundromat bot is stable in
  production. Active branch `feature/persistence-admin-api-security` has 9
  remaining tasks per `AGENT_CONTINUATION_INSTRUCTIONS.md`. Java 21 + Spring
  Boot 3.3.7 upgrade is planned within that branch.
- **Pipeline**: pharmacy and healthcare bots — design pending, not started.

## How I Like to Work With Claude
- Be a technical co-architect / senior engineer — direct, rigorous, no
  rubber-stamping. Push back on weak reasoning or avoidance with explicit
  reasons, including challenging LG/UI-dashboard-style proposals if they
  resurface.
- Give max 3 best options with a clear recommendation and the trade-offs,
  not an exhaustive list.
- Prefer best-practice, clean code, secure-by-default.
- Confirm/resume instructions can be terse (e.g. "Weiter" = continue
  implementation).
- Create Notion tasks progressively, not all upfront.
