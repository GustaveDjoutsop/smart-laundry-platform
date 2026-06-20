# ADR-002: Configuration-Driven Bot Logic

## Status
**Accepted** - January 2026

## Context

We're building a Bot-as-a-Service platform that will serve multiple industries (laundry, restaurants, pharmacies, healthcare). The key question:

**How do we support diverse business requirements without rewriting code for each client?**

### Options Considered

1. **Hardcoded Flows**
   - Each client gets custom code
   - Maximum flexibility
   - High maintenance cost

2. **Low-Code Builder**
   - Visual flow designer
   - Self-service for clients
   - High development cost

3. **Configuration-Driven**
   - JSON/YAML flow definitions
   - Code handles generic patterns
   - ~80% use cases without code changes

## Decision

We adopt a **Configuration-Driven Architecture** where:

### 1. Flows Defined in JSON
```json
{
  "flowId": "select_machine",
  "name": "Machine Selection",
  "states": [
    {
      "id": "show_machines",
      "type": "message",
      "template": "Available machines:\n{{#machines}}• {{name}} - {{status}}\n{{/machines}}",
      "buttons": [
        { "id": "machine_{{id}}", "text": "{{name}}" }
      ],
      "next": "confirm_selection"
    }
  ]
}
```

### 2. Template Engine for Messages
```javascript
// Mustache-style templates with context
const message = render(template, {
  machines: [
    { id: 'W1', name: 'Washer 1', status: 'Available' },
    { id: 'W2', name: 'Washer 2', status: 'In Use' }
  ]
});
```

### 3. Plugin System for Custom Logic
```javascript
// 80% handled by config, 20% by plugins
class LaundryPlugin extends BasePlugin {
  async beforePayment(context) {
    // Custom validation
    if (!context.selectedMachine) {
      throw new FlowError('No machine selected');
    }
  }
}
```

### 4. Configuration Hierarchy
```
Platform Config (defaults)
    └── Industry Config (restaurant, laundry)
        └── Client Config (specific overrides)
```

## Consequences

### Positive
- **Rapid onboarding:** New client in hours, not weeks
- **Non-technical changes:** Modify messages without deployment
- **Consistent behavior:** Same engine, fewer bugs
- **A/B testing ready:** Swap configs, measure results

### Negative
- **Config complexity:** Large configs hard to manage
- **Debugging indirection:** Flow errors need tracing
- **Limited flexibility:** 20% still needs code
- **Versioning challenges:** Config schema changes

### Coverage Estimate

| Use Case | Config | Code |
|----------|--------|------|
| Message templates | ✓ | |
| Button flows | ✓ | |
| Simple validation | ✓ | |
| Payment integration | | ✓ |
| IoT commands | | ✓ |
| Custom business logic | | ✓ |

**Result:** ~80% config, ~20% code

## Implementation

### Phase 1 (MVP)
- Hardcoded flows with template support
- Flow definitions in code (migration ready)

### Phase 2 (Scale)
- Move flows to database
- Admin UI for flow editing
- Version control for configs

### Phase 3 (Platform)
- Client self-service portal
- Flow marketplace
- Analytics per flow

## References
- [Configuration as Code](https://www.thoughtworks.com/radar/techniques/configuration-as-code)
- [State Machines in UX](https://statecharts.dev/)
