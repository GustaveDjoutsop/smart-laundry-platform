# Product Requirements Document (PRD)
# Bot-as-a-Service Platform - Smart Laundry MVP

**Version:** 1.0  
**Date:** January 2026  
**Author:** Sunday  
**Status:** In Development  
**Timeline:** 8 months (Target: September 2026)

---

## 1. Executive Summary

### 1.1 Vision
Build a scalable Bot-as-a-Service platform starting with Smart Laundry automation in Cameroon, then expanding to serve multiple industries (restaurants, pharmacies, healthcare) without requiring complete code rewrites for each client.

### 1.2 Problem Statement
- **For Businesses:** No affordable, localized WhatsApp automation solutions exist in Cameroon
- **For Consumers:** Manual payment and machine selection is inefficient
- **For Market:** Existing solutions don't integrate Cameroonian mobile payment systems

### 1.3 Solution
A multi-tenant WhatsApp bot platform with:
- Configuration-driven bot logic (80% use cases via JSON)
- Native mobile money integration (MTN MoMo, Orange Money, CamPay, Wave, Nkwa)
- ESP32 IoT integration for physical machine control
- Scalable architecture supporting multiple business types

---

## 2. Target Users

### 2.1 Primary Users (MVP)
| User Type | Description | Pain Points |
|-----------|-------------|-------------|
| **Laundry Customers** | Residents in Douala seeking laundry services | Manual payment, no real-time status |
| **Laundry Owner** | Sunday (initial client) | Machine monitoring, payment reconciliation |

### 2.2 Future Users (Post-MVP)
| User Type | Industry | Use Case |
|-----------|----------|----------|
| Restaurant Owners | Food Service | Order taking, delivery coordination |
| Pharmacy Managers | Healthcare | Inventory alerts, prescription reminders |
| Clinic Admins | Healthcare | Appointment routing, patient notifications |

---

## 3. Functional Requirements

### 3.1 WhatsApp Bot Core (Priority: P0)

#### FR-001: Message Handling
- **Requirement:** Process incoming WhatsApp messages via Meta Cloud API
- **Acceptance Criteria:**
  - Webhook receives messages within 5 seconds
  - Support text, button replies, and interactive lists
  - Handle media messages (images for receipts)

#### FR-002: Conversation Flow Engine
- **Requirement:** State machine-based conversation management
- **Acceptance Criteria:**
  - Flows defined via JSON configuration
  - State persists across messages (Redis-backed)
  - Timeout handling (30-minute default)
  - Context variables accessible in templates

#### FR-003: Multi-Tenant Support
- **Requirement:** Single deployment serves multiple businesses
- **Acceptance Criteria:**
  - Route by `phone_number_id`
  - Isolated conversation state per tenant
  - Separate bot configurations per client

### 3.2 Payment Integration (Priority: P0)

#### FR-004: CamPay Integration
- **Requirement:** Primary payment processor for MVP
- **Acceptance Criteria:**
  - Initiate collect requests
  - Handle webhook callbacks
  - Verify transaction signatures
  - Support XAF currency

#### FR-005: MTN Mobile Money
- **Requirement:** Fallback payment for wider coverage
- **Acceptance Criteria:**
  - OAuth2 token management
  - Request-to-Pay API integration
  - Transaction status polling

#### FR-006: Payment Status Tracking
- **Requirement:** Real-time payment monitoring
- **Acceptance Criteria:**
  - Track: PENDING → PROCESSING → COMPLETED/FAILED
  - Timeout after 10 minutes
  - Automatic notification on status change

### 3.3 Machine Control (Priority: P0)

#### FR-007: Machine State Management
- **Requirement:** Track 10 machines (6 washers, 4 dryers)
- **Acceptance Criteria:**
  - States: AVAILABLE, IN_USE, COMPLETING, ERROR, MAINTENANCE
  - Persist state across restarts
  - Query available machines

#### FR-008: ESP32 Communication
- **Requirement:** MQTT-based machine control
- **Acceptance Criteria:**
  - Topics: `laundry/machine-{id}/command`, `laundry/machine-{id}/status`
  - Commands: START, STOP, STATUS
  - Heartbeat monitoring (30-second intervals)

#### FR-009: Program Selection
- **Requirement:** Support multiple wash/dry programs
- **Acceptance Criteria:**
  - Programs: EXPRESS (30min/500F), STANDARD (45min/700F), INTENSIF (60min/1000F)
  - Validate program for machine type
  - Calculate end time

### 3.4 User Flows (Priority: P0)

#### FR-010: Main Menu Flow
```
User: "Hi" / Button: Start
→ Display welcome + main options
→ Options: [Select Machine] [Check Status] [Help]
```

#### FR-011: Machine Selection Flow
```
User: [Select Machine]
→ Show available machines (type + status)
→ User selects machine
→ Show program options with prices
→ User selects program
→ Initiate payment
```

#### FR-012: Payment Flow
```
→ Request phone number
→ Initiate mobile money request
→ User confirms on phone
→ Webhook confirms payment
→ Start machine via MQTT
→ Send confirmation + estimated end time
```

#### FR-013: Status Check Flow
```
User: [Check Status]
→ Query active sessions for user's phone
→ Show: Machine, Program, Time Remaining
→ Option: [Back to Menu]
```

### 3.5 Admin Dashboard (Priority: P1)

#### FR-014: Real-Time Monitoring
- Machine status overview
- Active sessions
- Revenue tracking (today/week/month)

#### FR-015: Financial Reports
- Export to Excel/PDF
- Revenue by payment provider
- Tax-ready summaries

---

## 4. Non-Functional Requirements

### 4.1 Performance
| Metric | Target | Measurement |
|--------|--------|-------------|
| Message Response Time | < 3 seconds | P95 latency |
| Webhook Processing | < 500ms | P95 latency |
| MQTT Command Delivery | < 1 second | End-to-end |
| Concurrent Users | 100+ | Simultaneous sessions |

### 4.2 Reliability
| Metric | Target |
|--------|--------|
| Uptime | 99.5% |
| Data Durability | No transaction loss |
| Failover | Graceful degradation (in-memory fallback) |

### 4.3 Security
- HTTPS everywhere
- Webhook signature verification
- Payment data encryption
- Rate limiting (100 req/min per user)
- No PII in logs

### 4.4 Scalability
- Horizontal scaling via stateless design
- Redis for shared state
- Message queue for async processing
- Database sharding ready

---

## 5. Technical Constraints

### 5.1 Platform Constraints
- **WhatsApp Business API:** Requires Meta-verified business
- **German Business Registration:** Einzelunternehmen for Meta verification
- **Network:** Allowed domains limited (see `network_configuration`)

### 5.2 Infrastructure
- **Hosting:** Heroku (initial), AWS/GCP (scale)
- **Database:** MongoDB (with in-memory fallback)
- **Cache:** Redis (required for state)
- **IoT:** ESP32-WROOM-32 + MQTT

### 5.3 Payment Provider Limits
| Provider | Limit | Notes |
|----------|-------|-------|
| CamPay | 1M XAF/day | Primary |
| MTN MoMo | 500K XAF/txn | Requires merchant account |
| Orange Money | TBD | Phase 2 |

---

## 6. Success Metrics

### 6.1 MVP Success Criteria (Month 3)
- [ ] 50+ successful transactions
- [ ] < 5% payment failure rate
- [ ] 10 machines operational
- [ ] WhatsApp Business verified

### 6.2 Growth Metrics (Month 6)
- [ ] 500+ monthly transactions
- [ ] 2+ client businesses onboarded
- [ ] < 2% customer complaints

### 6.3 Platform Metrics (Month 12)
- [ ] 5+ industries served
- [ ] Configuration covers 80% of use cases
- [ ] Revenue positive

---

## 7. Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Meta verification delay | High | Blocks launch | German registration complete, tax docs pending |
| Payment API changes | Medium | Service disruption | Multi-provider fallback |
| ESP32 connectivity | Medium | Machine offline | Retry logic, heartbeat monitoring |
| MongoDB unavailable | Low | Data loss | In-memory fallback implemented |

---

## 8. Timeline

### Phase 1: Foundation (Weeks 1-4) ✓
- [x] Core architecture
- [x] Singleton patterns
- [x] Redis integration
- [ ] QueueManager completion

### Phase 2: Bot Logic (Weeks 5-8)
- [ ] Conversation flows
- [ ] Payment integration
- [ ] MQTT communication

### Phase 3: Testing (Weeks 9-12)
- [ ] Sandbox testing
- [ ] ESP32 integration
- [ ] End-to-end flows

### Phase 4: Launch (Weeks 13-16)
- [ ] Meta verification
- [ ] Production deployment
- [ ] Machine installation

---

## 9. Open Questions

1. **Orange Money API:** Timeline for integration?
2. **Multi-location:** Same phone number or separate?
3. **Refund policy:** Automated or manual?
4. **Language support:** French only or add English?

---

## 10. Appendix

### A. Related Documents
- [Architecture Decision Records](../architecture/)
- [Design Specifications](../design/)
- [Payment API Guide](/mnt/project/guide_api_paiement.md)
- [Dashboard Architecture](/mnt/project/DASHBOARD_ARCHITECTURE.md)

### B. Glossary
| Term | Definition |
|------|------------|
| BaaS | Bot-as-a-Service |
| XAF | Central African CFA franc |
| MQTT | Message Queuing Telemetry Transport |
| ESP32 | Espressif IoT microcontroller |
