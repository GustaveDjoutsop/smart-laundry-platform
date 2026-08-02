# ADR-001: Monolithic Architecture for MVP

## Status
**Accepted** - January 2026

## Context

We need to decide the architectural approach for the Bot-as-a-Service platform. The options considered:

1. **Microservices Architecture**
   - Separate services: Auth, Bot Engine, Payment, IoT Gateway, Admin
   - Independent deployment and scaling
   - Complex infrastructure (Kubernetes, service mesh)

2. **Monolithic Architecture**
   - Single deployable unit with clear module boundaries
   - Simpler deployment (single Heroku dyno)
   - Easier debugging and development

3. **Modular Monolith**
   - Monolith with microservice-ready boundaries
   - Can extract services later
   - Best of both worlds

### Constraints
- **Timeline:** 8 months to MVP
- **Team Size:** 1 developer
- **Budget:** Limited (bootstrapped)
- **Experience:** Strong in Node.js, less in distributed systems

## Decision

We will implement a **Modular Monolith** with the following characteristics:

```
src/
├── core/                    # Shared infrastructure
│   ├── BotRegistry.js       # Bot instance management
│   ├── QueueManager.js      # Message processing
│   ├── RedisManager.js      # State management
│   ├── Logger.js            # Centralized logging
│   └── payments/            # Payment gateway abstraction
├── bots/                    # Bot implementations
│   └── laundry/             # Laundry-specific logic
│       ├── LaundryBot.js
│       └── flows/           # Conversation flows
└── server.js                # Single entry point
```

### Boundaries
- Clear interfaces between modules
- No direct database access from bots (use services)
- Dependency injection for testability
- Event-driven communication where appropriate

## Consequences

### Positive
- **Faster development:** Single codebase, no service coordination
- **Simpler deployment:** One Heroku dyno, one database
- **Easier debugging:** Full stack traces, single log stream
- **Lower cost:** No orchestration overhead

### Negative
- **Scaling limits:** Vertical scaling only initially
- **Deployment coupling:** All modules deploy together
- **Risk of tight coupling:** Requires discipline

### Migration Path
When we need to scale (>1000 concurrent users):
1. Extract Payment Gateway to separate service
2. Extract IoT Gateway for machine communication
3. Keep Bot Engine monolithic (stateless, scales horizontally)

## Alternatives Considered

### Full Microservices
Rejected because:
- Overkill for MVP traffic (< 100 concurrent)
- Kubernetes learning curve delays launch
- Distributed debugging is hard for one person

### Serverless (Lambda/Functions)
Rejected because:
- Cold start latency hurts WhatsApp response times
- MQTT connections don't work well
- Harder to reason about state

## References
- [Monolith First](https://martinfowler.com/bliki/MonolithFirst.html) - Martin Fowler
- [Modular Monolith](https://www.kamilgrzybek.com/design/modular-monolith-primer/) - Kamil Grzybek
