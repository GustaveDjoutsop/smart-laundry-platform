# AI Agent Instructions: spring-bot-manager Refactoring

## Context for the Agent

You are tasked with refactoring the `spring-bot-manager` repository to align with the target architecture defined in `smart-bot-platform-architecture.docx`. This is a WhatsApp multi-bot platform for a service company in Cameroon. The owner is a solo developer. The existing code is functional and deployed — do NOT break what works. Every change must be incremental and testable.

Repository: `https://github.com/GustaveDjoutsop/spring-bot-manager.git`

---

## SECTION 1: GAP ANALYSIS — What Exists vs What's Required

### 1.1 What the Codebase Does RIGHT (Do Not Touch)

These patterns are correct and match or exceed the target architecture. Preserve them:

| Pattern | Location | Assessment |
|---------|----------|------------|
| phone_number_id routing | `WhatsAppWebhookController.extractPhoneNumberId()` | Correct — matches Meta's design |
| Redis key prefixing | `BaseBot.loadConversationState()` — key format `conv:{botId}:{phone}` | Correct — state isolation works |
| Signature verification | `WhatsAppSignatureVerifier.verify()` — uses `MessageDigest.isEqual()` | Correct — constant-time comparison prevents timing attacks |
| Idempotency check | `MessageProcessor.processMessage()` — Redis SETNX with `lock:{botId}:{from}:{messageId}` | Correct — prevents duplicate processing |
| Error isolation | `MessageProcessor.processMessage()` — try-catch wraps `bot.handleMessage()` | Correct — one bot crash doesn't kill others |
| Rate limiting | `RateLimitFilter` with custom `TokenBucket` | Correct — per-IP, per-endpoint limiting |
| Global exception handler | `GlobalExceptionHandler` — catches all unhandled exceptions | Correct — prevents stack traces leaking to clients |
| i18n / TranslationService | `TranslationService` + `Language` enum | Good — exceeds architecture spec (we didn't design this) |
| Template rendering | `TemplateRenderer` using Mustache | Good — clean separation of templates from logic |
| FlowEngine state machine | `FlowEngine.step()` with `FlowState`, `FlowPlugin`, `FlowContext` | Good — more sophisticated than spec required |
| WhatsApp client caching | `WhatsAppClientFactory.clientCache` — ConcurrentHashMap | Good — avoids creating client per message |
| Payment event publishing | `PaymentEventPublisher` with Spring events | Good — event-driven, decoupled |
| PII protection | `LogRedactor` | Good — we recommended this |
| Non-root Docker user | `Dockerfile` — `appuser:appgroup` | Good — security best practice |
| Docker health check | `Dockerfile` — `/actuator/health` | Good |
| CI pipeline | `.github/workflows/ci.yml` — build, test, lint, OWASP, Docker | Good — exceeds spec |
| Retry with backoff | `WhatsAppClient.sendMessage()` — 3 retries with linear backoff | Acceptable for now |

### 1.2 CRITICAL Issues (Must Fix — Architecture Violations)

---

#### ISSUE 1: Not a Maven Multi-Module Project

**Current state:** Single `pom.xml`, single `jar` packaging, all code in one `src/` tree.

**Problem:** There is no compile-time enforcement of module boundaries. `bot-laundry` code can import `bot-thomasnetwork` code. The `BotConfig` core class contains laundry-specific fields (`machines`, `programs`). Without Maven modules, these violations are invisible until they cause cross-contamination bugs.

**Required state:** Maven parent POM with child modules: `bot-core`, `bot-whatsapp`, `bot-payment`, `bot-laundry`, `bot-pharmacy`, `bot-app`.

**Action:**

1. Create a new `pom.xml` at root with `<packaging>pom</packaging>` and `<modules>` section.
2. Create subdirectories: `bot-core/`, `bot-whatsapp/`, `bot-payment/`, `bot-laundry/`, `bot-app/`.
3. Each gets its own `pom.xml` with `<parent>` pointing to root.
4. Move classes according to this mapping:

```
CURRENT LOCATION                              → TARGET MODULE
─────────────────────────────────────────────────────────────────
com.botmanager.core.bot.BaseBot               → bot-core
com.botmanager.core.bot.BotConfig             → bot-core (REFACTORED — remove machine/program fields)
com.botmanager.core.bot.BotRegistry           → bot-core (REFACTORED — remove switch statement)
com.botmanager.core.bot.BotType               → DELETE (replaced by Spring auto-discovery)
com.botmanager.core.flow.*                    → bot-core
com.botmanager.core.i18n.*                    → bot-core
com.botmanager.core.redis.*                   → bot-core
com.botmanager.core.queue.*                   → bot-core
com.botmanager.core.machine.*                 → bot-core (interface only) + bot-laundry (implementation)
com.botmanager.core.payment.*                 → bot-payment
com.botmanager.core.payment.provider.*        → bot-payment
com.botmanager.core.whatsapp.*                → bot-whatsapp
com.botmanager.core.mqtt.*                    → bot-core (interface) + bot-laundry (config)
com.botmanager.controller.*                   → bot-whatsapp (webhook) + bot-payment (payment endpoints)
com.botmanager.handler.*                      → bot-whatsapp
com.botmanager.middleware.*                   → bot-core
com.botmanager.config.*                       → bot-app (app-level config) + relevant modules
com.botmanager.bots.laundry.*                 → bot-laundry
com.botmanager.bots.thomasnetwork.*           → bot-laundry (or its own module if justified)
com.botmanager.SpringBotManagerApplication    → bot-app
```

5. Dependency rules (enforce in each module's `pom.xml`):
   - `bot-core` depends on: Spring, Redis, Jackson. NOTHING ELSE.
   - `bot-whatsapp` depends on: `bot-core`
   - `bot-payment` depends on: `bot-core`
   - `bot-laundry` depends on: `bot-core` (NEVER on `bot-whatsapp` or `bot-payment` directly)
   - `bot-app` depends on: ALL modules (assembles the final JAR)

---

#### ISSUE 2: BotRegistry Hardcodes Bot Creation (Open/Closed Principle Violation)

**Current state:** `BotRegistry.createBotInstance()` lines 185-204:

```java
return switch (botType) {
    case LAUNDRY -> new LaundryBot(...);
    case THOMAS_NETWORK -> new ThomasNetworkBot(...);
};
```

Also `parseTypedConfig()` lines 150-161 has the same switch. Also `BotType` enum hardcodes all bot types.

**Problem:** Adding a new bot type requires modifying 3 files in the core module: `BotType.java`, `BotRegistry.createBotInstance()`, and `BotRegistry.parseTypedConfig()`. This violates the Open/Closed Principle and defeats the purpose of a plugin architecture.

**Required state:** Spring auto-discovers Bot beans. No switch statement. No `BotType` enum.

**Action:**

1. Delete `BotType.java` entirely.

2. Convert `BaseBot` from abstract class to interface named `Bot`:
```java
public interface Bot {
    String getBotId();
    String getPhoneNumberId();
    FlowPlugin getPlugin();
    void handleMessage(MessageJob job);
}
```

3. Keep `BaseBot` as an abstract class implementing `Bot` for shared behavior (state load/save, message sending).

4. Make each bot a Spring `@Component` with `@ConditionalOnProperty`:
```java
@Slf4j
@Component
@ConditionalOnProperty(prefix = "smartbot.bots.laundry", name = "enabled", havingValue = "true")
public class LaundryBot extends BaseBot { ... }
```

5. Refactor `BotRegistry` to accept `List<Bot>` via constructor injection:
```java
@Component
public class BotRouter {
    private final Map<String, Bot> phoneIdToBotMap;

    public BotRouter(List<Bot> bots) {
        this.phoneIdToBotMap = bots.stream()
            .collect(Collectors.toMap(Bot::getPhoneNumberId, Function.identity()));
        log.info("Auto-registered {} bots", bots.size());
    }

    public Optional<Bot> route(String phoneNumberId) {
        return Optional.ofNullable(phoneIdToBotMap.get(phoneNumberId));
    }
}
```

6. Move JSON config loading INTO each bot module (LaundryBot reads its own config file, not the registry).

---

#### ISSUE 3: BotConfig Leaks Domain Concepts Into Core

**Current state:** `BotConfig.java` (core class) contains:

```java
private List<MachineConfig> machines;
private Map<String, List<ProgramConfig>> programs;
```

These are laundry-specific concepts that have no business in a core class shared by all bots.

**Problem:** Every bot type is forced to carry machine/program fields. If a pharmacy bot is added, its config will have empty `machines` and `programs` fields. This creates confusion and violates separation of concerns.

**Action:**

1. Strip `BotConfig` to only contain universal fields:
```java
public class BotConfig {
    private String botId;
    private String botName;
    private String phoneNumberId;
    private String verifyToken;
    private String defaultFlowId;
    private Map<String, FlowDefinition> flows;
}
```

2. `LaundryBotConfig extends BotConfig` keeps the laundry-specific fields (it already does this — `LaundryBotConfig` exists). Ensure ALL machine/program fields live there, not in the parent.

3. Remove `MqttConfig` inner class from `BotConfig` — MQTT is infrastructure, not bot config. Move to `MqttProperties` (already exists).

---

#### ISSUE 4: No Database — Zero Persistence

**Current state:** No JPA dependency. No Flyway. No PostgreSQL. All state is in Redis (volatile). All payment records are in Redis with TTL. No message logging to a persistent store.

**Problem:** When Redis evicts keys or restarts, ALL conversation history, payment records, and business data is lost. For a service company handling payments, this is a critical business risk. You cannot reconcile payments without persistent records. You cannot debug customer issues without message logs. Tax compliance requires transaction records.

**Action:**

1. Add dependencies to the root POM (or `bot-core` module):
```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-jpa</artifactId>
</dependency>
<dependency>
    <groupId>org.postgresql</groupId>
    <artifactId>postgresql</artifactId>
    <scope>runtime</scope>
</dependency>
<dependency>
    <groupId>org.flywaydb</groupId>
    <artifactId>flyway-core</artifactId>
</dependency>
<dependency>
    <groupId>org.flywaydb</groupId>
    <artifactId>flyway-database-postgresql</artifactId>
</dependency>
```

2. Create Flyway migration `V1__core_schema.sql`:
```sql
CREATE TABLE businesses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bot_id VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    industry VARCHAR(50) NOT NULL,
    phone_number_id VARCHAR(50) UNIQUE NOT NULL,
    config JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID REFERENCES businesses(id),
    sender_phone VARCHAR(20) NOT NULL,
    direction VARCHAR(10) NOT NULL,
    message_type VARCHAR(20),
    content TEXT,
    whatsapp_msg_id VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID REFERENCES businesses(id),
    customer_phone VARCHAR(20) NOT NULL,
    provider VARCHAR(20) NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'XAF',
    status VARCHAR(20) NOT NULL,
    provider_ref VARCHAR(100),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_business ON messages(business_id, created_at DESC);
CREATE INDEX idx_payments_status ON payments(business_id, status);
```

3. Create JPA entities and Spring Data repositories for each table.

4. Update `PaymentStore` to write to PostgreSQL (keep Redis as cache layer).

5. Add message logging in `MessageProcessor` — log every inbound/outbound message to the `messages` table.

6. Add `application.properties`:
```properties
spring.datasource.url=${DATABASE_URL:jdbc:postgresql://localhost:5432/smartbot}
spring.jpa.hibernate.ddl-auto=validate
spring.flyway.enabled=true
```

---

#### ISSUE 5: Java 17, Not Java 21

**Current state:** `pom.xml` line 22: `<java.version>17</java.version>`. Dockerfile: `amazoncorretto:17-alpine`. CI: `java-version: '17'`.

**Problem:** Java 17 LTS support ends September 2025 (already expired). Java 21 is the current LTS (until September 2028). Java 21 provides records, pattern matching, virtual threads, sequenced collections.

**Action:**

1. Update `pom.xml`: `<java.version>21</java.version>`
2. Update `Dockerfile`: `FROM eclipse-temurin:21-jre-alpine`
3. Update all `.github/workflows/*.yml`: `java-version: '21'`
4. Refactor immutable DTOs to use Java records: `MessageJob`, `PaymentRequest`, `PaymentResult`, `IncomingMessage`, `ConversationState` (if appropriate — note ConversationState is mutable, so keep as class).

---

#### ISSUE 6: Spring Boot 3.2.2, Not 3.3.x

**Current state:** `pom.xml` line 9: `<version>3.2.2</version>`

**Action:** Update to `<version>3.3.7</version>` (latest 3.3.x patch). Run full test suite after update. Check for breaking changes in Spring Boot 3.3 release notes.

---

### 1.3 HIGH Issues (Should Fix — Quality and Reliability)

---

#### ISSUE 7: QueueManager Uses Raw Thread Instead of Spring TaskExecutor

**Current state:** `QueueManager` creates a raw daemon `Thread` with `new Thread(() -> { ... })`. This bypasses Spring's lifecycle management, thread pool monitoring, and graceful shutdown.

**Action:** Replace with Spring's `@Async` + `ThreadPoolTaskExecutor`:

1. Add `@EnableAsync` to the Spring Boot application class.
2. Configure a `ThreadPoolTaskExecutor` bean in `AppConfig`:
```java
@Bean(name = "webhookExecutor")
public TaskExecutor webhookExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(2);
    executor.setMaxPoolSize(4);
    executor.setQueueCapacity(500);
    executor.setThreadNamePrefix("webhook-");
    executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
    return executor;
}
```
3. Make `MessageProcessor.processMessage()` an `@Async("webhookExecutor")` method.
4. Delete `QueueManager.java` entirely — Spring manages the queue.

Alternatively, if you want to keep the explicit queue for backpressure control, at minimum replace `new Thread(...)` with a `ScheduledExecutorService` submitted via Spring's `DisposableBean` for proper shutdown.

---

#### ISSUE 8: Signature Verification Defaults to DISABLED

**Current state:** `application.properties` line 18: `whatsapp.verify-signature=${WHATSAPP_VERIFY_SIGNATURE:false}`

**Problem:** This means in production, if the env var is not set, ANY HTTP client can send fake webhook payloads to your endpoint. This is a security vulnerability.

**Action:** Change default to `true`:
```properties
whatsapp.verify-signature=${WHATSAPP_VERIFY_SIGNATURE:true}
```
Only disable in `application-local.properties` for development:
```properties
whatsapp.verify-signature=false
```

---

#### ISSUE 9: WhatsApp Client Uses Thread.sleep() for Retry Backoff

**Current state:** `WhatsAppClient.sendMessage()` line 114: `Thread.sleep(RETRY_DELAY_MS * attempt)`

**Problem:** This blocks the thread during retry delay, reducing throughput. In a webhook processing context, this can cause thread pool exhaustion under load.

**Action:** For now, this is acceptable since message volume is low. When migrating to `@Async`, consider using Spring Retry (`@Retryable`) or Resilience4j's retry module with non-blocking backoff. Mark this as a future improvement.

---

#### ISSUE 10: No Testcontainers for Integration Tests

**Current state:** Integration tests use Python + Robot Framework in a Docker Compose setup. Java tests mock Redis.

**Problem:** Java integration tests don't test real Redis or PostgreSQL behavior. The Python tests are separate from the Maven build lifecycle.

**Action:**

1. Add Testcontainers dependency:
```xml
<dependency>
    <groupId>org.testcontainers</groupId>
    <artifactId>postgresql</artifactId>
    <scope>test</scope>
</dependency>
<dependency>
    <groupId>org.testcontainers</groupId>
    <artifactId>junit-jupiter</artifactId>
    <scope>test</scope>
</dependency>
<dependency>
    <groupId>com.redis</groupId>
    <artifactId>testcontainers-redis</artifactId>
    <version>2.2.2</version>
    <scope>test</scope>
</dependency>
```

2. Create a `@TestConfiguration` that starts Postgres + Redis containers.

3. Write integration tests for: `MessageProcessor` end-to-end, `PaymentGateway` with real Redis, `BotRouter` auto-discovery, Flyway migrations.

---

#### ISSUE 11: Kubernetes/Helm Deployment Contradicts Target

**Current state:** Full Helm chart in `ci/helm-chart/` with Kubernetes deployment, service, secrets, and environment-specific values (`dev.yaml`, `prod.yaml`, `cicd.yaml`).

**Problem:** The target architecture specifies Heroku deployment at $15/mo. Kubernetes is orders of magnitude more expensive and complex for a solo developer. Having both deployment targets creates maintenance burden.

**Action:** Decide on ONE deployment target. If Heroku: add a `Procfile` and `system.properties`. If Kubernetes: remove Heroku references. Do NOT maintain both unless you have a specific reason (e.g., a client requires K8s). The Helm chart is well-structured — keep it if K8s is the actual target, but be honest about the cost.

---

### 1.4 MEDIUM Issues (Should Fix Before Adding New Bots)

---

#### ISSUE 12: MachineService/MachineStore Is in Core but Is Laundry-Specific

**Current state:** `core.machine.*` package contains `MachineService`, `MachineStore`, `MachineRecord`, `MachineConfig`, `MachineStatus`, `MachineType`, `ProgramConfig`. The `BotRegistry.registerBot()` calls `machineService.registerBot(config)` for EVERY bot, even if the bot has nothing to do with machines.

**Action:**
1. Move `MachineService`, `MachineStore`, `MachineRecord`, etc. into `bot-laundry` module.
2. Remove `machineService.registerBot(config)` from `BotRegistry` — the LaundryBot should initialize its own machines.
3. If other bots need "resource management" (e.g., pharmacy inventory), create a generic interface in core and implement it per-bot.

---

#### ISSUE 13: FlowPlugin Is an Abstract Class, Should Be Interface

**Current state:** `FlowPlugin` is an abstract class with a concrete `goTo()` helper method.

**Action:** Convert to interface with default method:
```java
public interface FlowPlugin {
    void handleAction(String action, Map<String, Object> params, FlowContext context);

    default void goTo(FlowContext context, String targetStateId) {
        context.setGotoTarget(targetStateId);
    }
}
```

This allows bot plugins to implement multiple interfaces without class hierarchy conflicts.

---

#### ISSUE 14: `verifyToken` Stored in JSON Config Files (Potential Secret Leak)

**Current state:** `laundry.bot.json` line 5: `"verifyToken": "myTester"`. Config files are committed to Git.

**Problem:** Verify tokens should not be in version-controlled files. If the repo becomes public (it is public right now), these tokens are exposed.

**Action:**
1. Remove `verifyToken` from JSON config files.
2. Load verify tokens from environment variables: `VERIFY_TOKEN_{BOT_ID}`.
3. Same pattern already used for access tokens in `WhatsAppClientFactory` — be consistent.
4. Add `configs/bots/*.json` to a security review checklist — ensure no secrets in committed files.

---

## SECTION 2: EXECUTION ORDER

Do these in this exact order. Each step must compile and pass tests before moving to the next.

```
Step 1: Upgrade Java 21 + Spring Boot 3.3          (1 day)
        - Update pom.xml, Dockerfile, CI
        - Run existing tests, fix any breakage

Step 2: Fix security defaults                       (0.5 day)
        - verify-signature=true by default
        - Move verifyToken to env vars
        - Verify LogRedactor covers all sensitive fields

Step 3: Add PostgreSQL + Flyway                     (2 days)
        - Add dependencies
        - Create V1 migration
        - Create JPA entities + repositories
        - Update PaymentStore to persist to DB
        - Add message logging
        - Add docker-compose.yml with Postgres for local dev

Step 4: Clean BotConfig (remove domain leak)        (1 day)
        - Remove machines/programs from BotConfig
        - Ensure LaundryBotConfig carries all laundry fields
        - Move MachineService to laundry package

Step 5: Convert to Maven multi-module               (2-3 days)
        - Create module POMs
        - Move files per mapping in Issue 1
        - Fix all imports
        - Verify compile + tests pass per module

Step 6: Refactor BotRegistry to auto-discovery      (1 day)
        - Delete BotType enum
        - Make bots @Component with @ConditionalOnProperty
        - Inject List<Bot> in BotRouter
        - Move JSON loading to each bot module

Step 7: Replace QueueManager with Spring @Async     (1 day)
        - Configure ThreadPoolTaskExecutor
        - Delete QueueManager
        - Add @Async to message processing

Step 8: Add Testcontainers integration tests        (2 days)
        - PostgreSQL + Redis containers
        - End-to-end webhook processing test
        - Payment flow test
        - Multi-bot routing test

Step 9: Decide deployment target (Heroku vs K8s)    (0.5 day)
        - If Heroku: add Procfile, system.properties
        - If K8s: keep Helm, remove Heroku refs
        - Document the decision

Step 10: Add bot-pharmacy module                    (3-5 days)
        - New Maven module
        - PharmacyBot implements Bot
        - PharmacyFlowPlugin with inventory actions
        - pharmacy_products + pharmacy_reservations tables
        - Integration tests
```

**Total estimated effort: 14-17 days for a skilled developer.**

---

## SECTION 3: RULES FOR THE AGENT

1. **Never break the LaundryBot.** It is in production. Every refactoring step must keep it functional. Run the existing tests after each change.

2. **One commit per step.** Each step above should be a separate, reviewable commit or PR. Do not combine steps.

3. **No new features during refactoring.** Steps 1-9 are purely structural. Do not add pharmacy bot features, new payment providers, or UI changes during refactoring.

4. **Preserve the FlowEngine.** The JSON-driven state machine is a differentiator. It works well. Do not replace it — just ensure it's in the correct module.

5. **Keep Redis for state, add Postgres for persistence.** Redis remains the primary state store for active conversations (fast, TTL-based). Postgres stores the audit trail (messages, payments, business config). Dual-write pattern.

6. **Do not over-engineer.** No Kubernetes if deploying to Heroku. No message broker if `@Async` suffices. No Redis Cluster if single instance handles the load. Match infrastructure to actual traffic.

7. **Test the signature verification.** After changing the default to `true`, verify that the webhook still works in the deployed environment. If the app secret is not configured, it will reject ALL webhooks.

---

## SECTION 4: FILES TO DELETE

```
src/main/java/com/botmanager/core/bot/BotType.java      — replaced by Spring auto-discovery
src/main/java/com/botmanager/core/queue/QueueManager.java — replaced by Spring @Async
src/main/java/com/botmanager/core/queue/MessageJob.java  — keep, but convert to Java record
document/strategic decision.md                            — outdated, replace with this document
```

---

## SECTION 5: SCORECARD — Current State

| Category | Score | Notes |
|----------|-------|-------|
| Core routing & isolation | 9/10 | phone_number_id routing, Redis prefixing, idempotency — all correct |
| Security | 5/10 | Signature verification exists but defaults OFF. No secrets rotation. Tokens in Git. |
| Persistence | 2/10 | Redis-only. No database. Payment records volatile. No audit trail. |
| Module boundaries | 3/10 | Single module. BotConfig leaks domain. BotRegistry has switch statement. |
| Code quality | 7/10 | Clean code, good naming, proper logging, Lombok used well |
| Testing | 4/10 | 4 unit tests. No integration tests in Maven. Python tests separate. |
| Deployment | 6/10 | Docker + CI good. Helm chart exists. But no clear single target. |
| Scalability | 6/10 | FlowEngine is solid. Plugin pattern works. Adding bots requires core changes (bad). |
| Production readiness | 5/10 | Running and stable, but missing persistence, monitoring, proper security defaults |

**Overall: 5.2/10 — Functional prototype that needs structural hardening before onboarding paying clients.**
