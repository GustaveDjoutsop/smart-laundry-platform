# ADR-005: Multi-Bot WhatsApp System Architecture

**Status:** Accepted  
**Date:** January 2025  
**Decision Makers:** Sunday (Project Lead)  
**Category:** System Architecture

---

## Executive Summary

This document records the architectural decision to adopt a **Multi-Bot WhatsApp System** for the Bot-as-a-Service platform. This architecture enables serving multiple businesses (Smart Laundry, Restaurants, Pharmacies, Healthcare) through a single backend while maintaining complete isolation between business contexts.

---

## 1. Context

We are building a **Bot-as-a-Service platform** in Cameroon that needs to serve multiple industries through WhatsApp automation:

| Industry | Bot Purpose |
|----------|-------------|
| **Smart Laundry** | Machine status, payments, reservations (proof-of-concept) |
| **Restaurants** | Menu display, orders, table reservations |
| **Pharmacies** | Medicine search, inventory, delivery tracking |
| **Healthcare** | Doctor appointments, reminders, patient communication |

Each business requires:
- Its own WhatsApp Business Account with a dedicated phone number
- Distinct branding and welcome messages
- Independent conversation flows
- Isolated customer state management

### The Problem Statement

How do we architect a system that:
1. Serves multiple businesses through WhatsApp
2. Prevents flow confusion between different business contexts
3. Maintains isolated state for each customer per business
4. Remains cost-effective with single infrastructure
5. Scales to N clients without code rewrites

---

## 2. Decision

**We adopt the Multi-Bot WhatsApp System architecture.**

```
One Meta Business Portfolio
└── N WhatsApp Business Accounts (separate phone numbers)
    └── 1 Single Backend (Heroku) with intelligent routing
```

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Heroku App (Single Deployment)                │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              /api/whatsapp/webhook (Single endpoint)        │ │
│  │                                                             │ │
│  │  GET  → Verification (checks verify_token → identifies bot) │ │
│  │  POST → Messages (checks phone_number_id → routes to bot)   │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              │                                   │
│              ┌───────────────┼───────────────┐                  │
│              ▼               ▼               ▼                  │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐            │
│  │  LaundryBot  │ │ RestaurantBot│ │  PharmacyBot │  ...       │
│  │              │ │              │ │              │            │
│  │ Redis:       │ │ Redis:       │ │ Redis:       │            │
│  │ laundry:*    │ │ restaurant:* │ │ pharmacy:*   │            │
│  │              │ │              │ │              │            │
│  │ Flows:       │ │ Flows:       │ │ Flows:       │            │
│  │ - status     │ │ - menu       │ │ - search     │            │
│  │ - payment    │ │ - orders     │ │ - orders     │            │
│  │ - reserve    │ │ - reserve    │ │ - delivery   │            │
│  └──────────────┘ └──────────────┘ └──────────────┘            │
│                              │                                   │
│              ┌───────────────┴───────────────┐                  │
│              ▼                               ▼                  │
│  ┌──────────────────────┐    ┌──────────────────────┐          │
│  │   PostgreSQL DB      │    │      Redis Cache      │          │
│  │   (Shared Tables)    │    │   (Prefixed Keys)     │          │
│  └──────────────────────┘    └──────────────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Solutions Evaluated

### Solution 1: Separate Backends per Business ❌ REJECTED

**Architecture:** 4 Heroku apps × 4 codebases × 4 payment integrations

**Pros:**
- Complete isolation between businesses
- Independent deployments and scaling
- No risk of cross-contamination

**Cons:**
- 4× maintenance burden (bugs fixed 4 times)
- 4× hosting costs (~$28/month × 4 = $112/month minimum)
- Duplicated payment integrations (MTN MoMo, Wave, Orange, CamPay)
- No code reuse
- Difficult to maintain consistency across platforms

**Verdict:** Not scalable for Bot-as-a-Service model.

---

### Solution 2: Monolithic Single-Bot ❌ REJECTED

**Architecture:** 1 WhatsApp number handling all business types

**Pros:**
- Simple setup
- Single phone number to manage
- Easy deployment

**Cons:**
- Flow confusion (restaurant logic mixing with laundry)
- State management nightmare
- Poor customer experience (confusing menus)
- No business identity separation
- Violates Meta's intended usage pattern
- Cannot scale to multiple clients

**Verdict:** Fundamentally flawed for multi-business use case.

---

### Solution 3: Multi-Bot with Shared Infrastructure ✅ ACCEPTED

**Architecture:** 1 Backend + N WhatsApp Business Accounts + Intelligent Routing

**Pros:**
- Proper separation of concerns
- Shared infrastructure (cost-effective: ~$7-14/month)
- Independent bot identity and branding
- Isolated state per business
- Config-driven (80% JSON configuration, 20% custom code)
- Scalable to N clients without code changes
- Meta-compliant architecture

**Cons:**
- More complex routing logic (mitigated by well-tested BotRegistry)
- Requires careful state key prefixing (enforced by convention)
- Single point of failure (mitigated by Heroku reliability)

**Verdict:** Best balance of scalability, cost, and maintainability.

---

## 4. Key Architectural Decisions

### 4.1 Routing by `phone_number_id`

Every incoming WhatsApp message contains metadata identifying the recipient business:

```javascript
// Incoming webhook payload
{
  "entry": [{
    "changes": [{
      "value": {
        "metadata": {
          "phone_number_id": "123456789012345"  // Identifies the bot
        },
        "messages": [{
          "from": "237670111111",
          "text": { "body": "Hello" }
        }]
      }
    }]
  }]
}

// Router logic
const bot = botRegistry.getBotByPhoneId("123456789012345");
// Returns LaundryBot instance
await bot.handleMessage(message);
```

### 4.2 State Isolation via Redis Key Prefixing

Same customer interacting with different businesses maintains completely separate conversation states:

```
Redis Key Structure:
─────────────────────────────────────────────────────────
laundry:conversation:237670111111     → {flow: "payment", step: 2}
restaurant:conversation:237670111111  → {flow: "menu", step: 1}
pharmacy:conversation:237670111111    → {flow: "search", step: 3}
─────────────────────────────────────────────────────────

Same phone number, completely isolated contexts.
No flow confusion possible.
```

### 4.3 Single Webhook, Multiple Verify Tokens

Meta calls the webhook during verification with different tokens per bot:

```javascript
// Verification requests (one per bot during setup)
GET /api/whatsapp/webhook?hub.verify_token=laundry_verify_secret_2024
GET /api/whatsapp/webhook?hub.verify_token=restaurant_verify_secret_2024
GET /api/whatsapp/webhook?hub.verify_token=pharmacy_verify_secret_2024
GET /api/whatsapp/webhook?hub.verify_token=doctor_verify_secret_2024

// Server identifies bot by verify_token and logs association
if (verifyTokens.laundry === token) {
  console.log('Verified LaundryBot webhook');
  return res.send(challenge);
}
```

### 4.4 BotRegistry Pattern

Central registry manages all bot instances with complete isolation:

```javascript
class BotRegistry {
  constructor() {
    this.bots = new Map();           // botName → BotInstance
    this.phoneIdToBot = new Map();   // phoneNumberId → botName
    this.verifyTokenToBot = new Map(); // verifyToken → botName
  }

  registerBot(name, config, flows) {
    const bot = new WhatsAppBot(name, config, flows);
    this.bots.set(name, bot);
    this.phoneIdToBot.set(config.phoneNumberId, name);
    this.verifyTokenToBot.set(config.verifyToken, name);
    console.log(`Registered bot: ${name} with ${flows.length} flows`);
  }

  routeMessage(phoneNumberId, message) {
    const botName = this.phoneIdToBot.get(phoneNumberId);
    if (!botName) throw new Error(`No bot for phone_id: ${phoneNumberId}`);
    
    const bot = this.bots.get(botName);
    return bot.handleMessage(message);
  }
}
```

### 4.5 Config-Driven Flow Definitions

80% of bot logic is configurable via JSON, enabling rapid deployment of new clients:

```json
{
  "botName": "laundry",
  "phoneNumberId": "123456789012345",
  "verifyToken": "laundry_verify_secret_2024",
  "welcomeMessage": "Bienvenue à Smart Laundry! 🧺",
  "flows": {
    "machine-status": {
      "triggers": ["status", "statut", "machines", "1"],
      "steps": [
        { "action": "fetchMachineStatus" },
        { "action": "formatStatusMessage" },
        { "action": "sendReply" }
      ]
    },
    "payment": {
      "triggers": ["pay", "payer", "2"],
      "steps": [
        { "action": "askMachineNumber" },
        { "action": "askPaymentMethod" },
        { "action": "initiatePayment" },
        { "action": "confirmPayment" }
      ]
    }
  }
}
```

---

## 5. Consequences

### Positive Outcomes

| Benefit | Impact |
|---------|--------|
| **Scalability** | Add new clients via config changes, not code rewrites |
| **Cost Efficiency** | Single Heroku dyno serves all businesses (~$7-14/month) |
| **Maintainability** | One codebase, shared payment integrations |
| **Customer Experience** | Each business has distinct identity and flows |
| **Meta Compliance** | Architecture matches Meta's intended design pattern |
| **Testing Isolation** | Test one bot without affecting others |
| **Deployment Safety** | Update one bot's config without breaking others |
| **Payment Reuse** | MTN MoMo, Wave, Orange, CamPay integrated once, used by all |

### Risks and Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Single point of failure | Medium | Heroku reliability + health monitoring + auto-restart |
| Complex routing logic | Low | Well-tested BotRegistry with 100% unit test coverage |
| State key collisions | Low | Strict prefixing convention enforced in RedisManager |
| Memory pressure with many bots | Medium | Lazy loading + Redis for state (not in-memory) |
| Configuration errors | Medium | JSON schema validation on bot config load |

### Technical Debt Accepted

1. Need comprehensive integration tests for multi-bot scenarios
2. Documentation required for onboarding new businesses
3. Monitoring dashboard for per-bot metrics (planned for Phase 2)

---

## 6. Implementation Status

| Component | Status | Notes |
|-----------|--------|-------|
| BotRegistry | ✅ Complete | Singleton pattern, phone_id routing |
| RedisManager | ✅ Complete | Prefixed key management with TTL |
| LaundryBot | ✅ Complete | 5 flows, 10 machines integration |
| Webhook Router | ✅ Complete | Multi-token verification |
| Config Loader | ✅ Complete | JSON-based flow definitions |
| RestaurantBot | 🔲 Pending | Template ready, awaiting client |
| PharmacyBot | 🔲 Pending | Template ready, awaiting client |
| DoctorBot | 🔲 Pending | Template ready, awaiting client |

---

## 7. Real-World Architecture Diagram

```
Your Meta Business Portfolio (German Einzelunternehmen)
│
├─── WhatsApp Business Account: Smart Laundry (+237-6XX-XXX-001)
│     ├── Bot Logic: Machine status, payments, reservations
│     ├── Database: laundry_machines, laundry_transactions
│     ├── Redis Keys: laundry:*
│     └── Team Access: Laundry staff
│
├─── WhatsApp Business Account: Restaurant (+237-6XX-XXX-002)
│     ├── Bot Logic: Menu, reservations, orders
│     ├── Database: restaurant_menu, restaurant_orders
│     ├── Redis Keys: restaurant:*
│     └── Team Access: Restaurant manager
│
├─── WhatsApp Business Account: Pharmacy (+237-6XX-XXX-003)
│     ├── Bot Logic: Medicine search, orders, delivery
│     ├── Database: pharmacy_inventory, pharmacy_orders
│     ├── Redis Keys: pharmacy:*
│     └── Team Access: Pharmacist
│
└─── WhatsApp Business Account: Doctor (+237-6XX-XXX-004)
      ├── Bot Logic: Appointments, reminders
      ├── Database: doctor_appointments, doctor_patients
      ├── Redis Keys: doctor:*
      └── Team Access: Medical secretary

                    │
                    ▼
    ┌───────────────────────────────────┐
    │     Single Node.js Backend        │
    │     (Heroku - $7/month)           │
    │                                   │
    │  • Express.js server              │
    │  • BotRegistry (routing)          │
    │  • Payment Services (shared)      │
    │  • MQTT Publisher (machines)      │
    └───────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
┌───────────────┐       ┌───────────────┐
│  PostgreSQL   │       │    Redis      │
│  (Heroku)     │       │   (Heroku)    │
└───────────────┘       └───────────────┘
```

---

## 8. Business Justification

### Cost Comparison

| Approach | Monthly Cost | Annual Cost |
|----------|--------------|-------------|
| Separate Backends (4×) | $112+ | $1,344+ |
| **Multi-Bot (Shared)** | **$14** | **$168** |
| **Savings** | **$98/month** | **$1,176/year** |

### Revenue Potential

With Bot-as-a-Service model:
- Charge clients $50-200/month for bot configuration
- 10 clients = $500-2,000/month revenue
- Infrastructure cost remains ~$14/month
- **Gross margin: 97%+**

---

## 9. References

- [Meta WhatsApp Business API Documentation](https://developers.facebook.com/docs/whatsapp/cloud-api)
- ADR-002: Config-Driven Bot Architecture
- ADR-003: Redis State Management
- ADR-004: Payment Abstraction Layer
- [Project Context: Smart Laundry Cameroon](/mnt/project/architecture_buanderie.html)

---

## 10. Decision Record

| Date | Author | Decision |
|------|--------|----------|
| January 2025 | Sunday | Accepted Multi-Bot architecture |
| January 2025 | Claude | Documented rationale and implementation |

---

*Document Version: 1.0*  
*Last Updated: January 26, 2025*  
*Project: Smart Laundry Bot-as-a-Service Platform*
