# Architecture Decision Records (ADR)

This directory contains architecture decisions for the Bot-as-a-Service Platform.

## Decision Log

| ID | Title | Status | Date |
|----|-------|--------|------|
| [ADR-001](ADR-001-monolithic-architecture.md) | Monolithic vs Microservices | Accepted | Jan 2026 |
| [ADR-002](ADR-002-configuration-driven-bots.md) | Configuration-Driven Bot Logic | Accepted | Jan 2026 |
| [ADR-003](ADR-003-state-management.md) | Redis for State Management | Accepted | Jan 2026 |
| [ADR-004](ADR-004-payment-abstraction.md) | Payment Gateway Abstraction | Accepted | Jan 2026 |
| [ADR-005](ADR-005-singleton-patterns.md) | Singleton Pattern for Core Services | Accepted | Jan 2026 |
| [ADR-006](ADR-006-graceful-degradation.md) | Graceful Degradation Strategy | Accepted | Jan 2026 |
| [ADR-007](ADR-007-mqtt-protocol.md) | MQTT for IoT Communication | Accepted | Jan 2026 |

## ADR Template

```markdown
# ADR-XXX: Title

## Status
Proposed | Accepted | Deprecated | Superseded

## Context
What is the issue that we're seeing that is motivating this decision?

## Decision
What is the change that we're proposing?

## Consequences
What becomes easier or more difficult?
```
