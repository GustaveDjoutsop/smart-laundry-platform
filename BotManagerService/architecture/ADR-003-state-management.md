# ADR-003: Redis for Conversation State Management

## Status
**Accepted** - January 2026

## Context

WhatsApp bot conversations are stateful:
- User selects machine → stored
- User starts payment → must remember machine
- Session can span multiple HTTP requests
- State must survive server restarts

### Requirements
1. **Fast reads:** < 10ms for state lookup
2. **TTL support:** Auto-expire abandoned sessions
3. **Multi-tenant:** Isolated state per bot/user
4. **Atomic operations:** Prevent race conditions

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **In-Memory (Map)** | Fastest | Lost on restart, no sharing |
| **MongoDB** | Flexible schema | Slower, overkill for ephemeral |
| **Redis** | Fast, TTL, atomic | Extra infra |
| **PostgreSQL** | ACID, familiar | Too heavy for session data |

## Decision

Use **Redis** as the primary state store with the following design:

### Key Structure
```
# Conversation state (per user per bot)
conv:{botId}:{phoneNumber} = {
  currentFlow: "select_machine",
  currentState: "show_machines",
  context: { selectedMachine: "W1", ... },
  lastActivity: 1706284800
}
TTL: 1800 seconds (30 minutes)

# Machine state (per machine)
machine:{botId}:{machineId} = {
  status: "AVAILABLE",
  currentUser: null,
  program: null
}
TTL: none (persistent)

# Session lock (prevent double processing)
lock:{botId}:{phoneNumber}:{messageId} = 1
TTL: 60 seconds
```

### Operations
```javascript
// Get state (with fallback)
async getState(botId, phone) {
  const key = `conv:${botId}:${phone}`;
  const data = await redis.get(key);
  return data ? JSON.parse(data) : this.defaultState();
}

// Set state (atomic with TTL)
async setState(botId, phone, state) {
  const key = `conv:${botId}:${phone}`;
  await redis.setex(key, 1800, JSON.stringify(state));
}

// Acquire lock (idempotency)
async acquireLock(botId, phone, messageId) {
  const key = `lock:${botId}:${phone}:${messageId}`;
  return await redis.set(key, '1', 'EX', 60, 'NX');
}
```

### Fallback Strategy
```javascript
class RedisManager {
  constructor() {
    this.fallbackCache = new Map();
    this.connected = false;
  }
  
  async get(key) {
    if (this.connected) {
      return await this.redis.get(key);
    }
    // Graceful degradation
    return this.fallbackCache.get(key);
  }
}
```

## Consequences

### Positive
- **Performance:** Sub-millisecond state access
- **TTL built-in:** No manual session cleanup
- **Atomic ops:** SETNX for locks, INCR for counters
- **Pub/Sub ready:** Real-time machine status updates

### Negative
- **Extra dependency:** Must run Redis server
- **Data volatility:** Redis restart clears state
- **Memory cost:** All state in RAM
- **Serialization:** JSON overhead

### Mitigations
- **Dependency:** Heroku Redis add-on (managed)
- **Volatility:** Critical data also in MongoDB
- **Memory:** TTL keeps dataset bounded
- **Serialization:** Acceptable for our data size

## Monitoring

```javascript
// Key metrics to track
- redis_connected: boolean
- redis_latency_ms: histogram
- redis_memory_mb: gauge
- conv_active_sessions: gauge (count of conv:* keys)
```

## References
- [Redis for Session Management](https://redis.io/docs/manual/patterns/twitter-clone/)
- [Redis TTL Best Practices](https://redis.io/commands/expire/)
