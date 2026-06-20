# WhatsApp Bot State Machine Diagram

## State Flow Diagram (Mermaid)

```mermaid
stateDiagram-v2
    [*] --> LANGUAGE_SELECTION: New user sends message

    state LANGUAGE_SELECTION {
        [*] --> prompt
        prompt --> lang_en: English
        prompt --> lang_fr: Français
    }

    LANGUAGE_SELECTION --> AWAITING_LANGUAGE_CHOICE: Display language options
    AWAITING_LANGUAGE_CHOICE --> MAIN_MENU: Language selected (saved)

    MAIN_MENU --> AWAITING_MENU_CHOICE: Display welcome message (in chosen language)

    state AWAITING_MENU_CHOICE {
        [*] --> waiting
        waiting --> action_services: 📋 Our Services
        waiting --> action_wash: 🧺 Start a Wash
        waiting --> action_my_status: 📊 My Status
        waiting --> action_availability: 📊 Availability
    }

    AWAITING_MENU_CHOICE --> AWAITING_MENU_CHOICE: action_services (show services info)
    AWAITING_MENU_CHOICE --> AWAITING_MENU_CHOICE: action_my_status (show user's cycle)
    AWAITING_MENU_CHOICE --> AWAITING_MENU_CHOICE: action_availability (show machine status)
    AWAITING_MENU_CHOICE --> SELECT_MACHINE_METHOD: action_wash (machines available)
    AWAITING_MENU_CHOICE --> AWAITING_MENU_CHOICE: action_wash (no machines)

    state SELECT_MACHINE_METHOD {
        [*] --> choose_method
        choose_method --> select_enter_id: 📝 Enter Machine ID
        choose_method --> select_choose: 📋 Choose from List
    }

    SELECT_MACHINE_METHOD --> AWAITING_MANUAL_MACHINE_ID: select_enter_id
    SELECT_MACHINE_METHOD --> AWAITING_MACHINE_SELECTION: select_choose

    AWAITING_MANUAL_MACHINE_ID --> SELECT_CYCLE: Valid machine found
    AWAITING_MANUAL_MACHINE_ID --> AWAITING_MANUAL_MACHINE_ID: Invalid machine (retry)

    AWAITING_MACHINE_SELECTION --> SELECT_CYCLE: machine_xxx selected
    AWAITING_MACHINE_SELECTION --> AWAITING_MACHINE_SELECTION: Machine unavailable (retry)

    state SELECT_CYCLE {
        [*] --> select_duration
        select_duration --> cycle_short: Short cycle
        select_duration --> cycle_long: Long cycle
    }

    SELECT_CYCLE --> PAYMENT_PROCESSING: cycle selected

    state PAYMENT_PROCESSING {
        [*] --> initiating
        initiating --> prompt_sent: Payment prompt sent to phone
        initiating --> failed: Payment request failed
    }

    PAYMENT_PROCESSING --> SESSION_CLEARED: clearSession()

    SESSION_CLEARED --> MAIN_MENU: User types start/cancel/hi

    note right of LANGUAGE_SELECTION
        Language preference is
        persisted across sessions.
        Returning users skip to
        MAIN_MENU directly.
    end note

    note right of PAYMENT_PROCESSING
        After payment is initiated,
        session is cleared.
        User must type 'start' or
        'cancel' to return to menu.
    end note

    %% Global cancel - from ANY state (preserves language)
    AWAITING_MENU_CHOICE --> MAIN_MENU: cancel/reset/stop
    SELECT_MACHINE_METHOD --> MAIN_MENU: cancel/reset/stop
    AWAITING_MANUAL_MACHINE_ID --> MAIN_MENU: cancel/reset/stop
    AWAITING_MACHINE_SELECTION --> MAIN_MENU: cancel/reset/stop
    SELECT_CYCLE --> MAIN_MENU: cancel/reset/stop
```

## States Overview

| State | Description | Next States |
|-------|-------------|-------------|
| `LANGUAGE_SELECTION` | First-time users choose language (EN/FR) | → `AWAITING_LANGUAGE_CHOICE` |
| `AWAITING_LANGUAGE_CHOICE` | Waiting for language selection | → `MAIN_MENU` |
| `MAIN_MENU` | Entry point, shows welcome message | → `AWAITING_MENU_CHOICE` |
| `AWAITING_MENU_CHOICE` | User chooses action from menu | → `SELECT_MACHINE_METHOD`, stays in same state |
| `SELECT_MACHINE_METHOD` | User chooses how to select machine | → `AWAITING_MANUAL_MACHINE_ID`, `AWAITING_MACHINE_SELECTION` |
| `AWAITING_MANUAL_MACHINE_ID` | User types machine ID manually | → `SELECT_CYCLE` or retry |
| `AWAITING_MACHINE_SELECTION` | User picks from machine list | → `SELECT_CYCLE` or retry |
| `SELECT_CYCLE` | User chooses wash duration | → Payment processing, then cleared |
| `(cleared)` | Session cleared after payment | → `MAIN_MENU` on next message |

## Global Reset Commands

These commands work from **ANY state** and reset to `MAIN_MENU`:
- `hi`
- `hello`
- `start`
- `reset`
- `cancel`
- `stop`
- `action_cancel` (button)

## Payment Flow Note

```
┌─────────────────────────────────────────────────────────────────┐
│  IMPORTANT: Payment Cancellation                                │
├─────────────────────────────────────────────────────────────────┤
│  When user types "cancel" after payment prompt is sent:         │
│                                                                 │
│  ✅ WhatsApp bot resets to MAIN_MENU                           │
│  ❌ Mobile Money payment request is NOT cancelled              │
│                                                                 │
│  The payment prompt on the user's phone remains active.         │
│  If they approve it, the machine WILL start.                    │
│                                                                 │
│  The transaction stays in PENDING status in MongoDB until:      │
│  - User approves → webhook updates to SUCCESSFUL                │
│  - User declines → webhook updates to FAILED                    │
│  - Timeout → stays PENDING (machine unlocked after 5 minutes)   │
└─────────────────────────────────────────────────────────────────┘
```

## Asynchronous Notifications (Outside State Machine)

These notifications are sent independently of the conversation state, triggered by backend events:

```mermaid
sequenceDiagram
    participant User as User (WhatsApp)
    participant Bot as WhatsApp Bot
    participant Webhook as Payment Webhook
    participant Monitor as Cycle Monitor Service

    Note over User,Monitor: Payment Success Flow
    User->>Bot: Initiates payment
    Bot->>User: "Payment prompt sent..."
    Webhook->>Bot: Payment SUCCESSFUL callback
    Bot->>User: ✅ "Payment Confirmed! Machine ready..."

    Note over User,Monitor: Payment Failure Flow
    Webhook->>Bot: Payment FAILED callback
    Bot->>User: ❌ "Payment Failed. Please try again."

    Note over User,Monitor: Cycle Completion Flow (runs every 60s)
    Monitor->>Monitor: Check for completed cycles
    Monitor->>Bot: Cycle ended for user X
    Bot->>User: 🎉 "Your laundry is ready! Please collect your clothes."
```

### Notification Messages

| Event | Message (EN) | Message (FR) |
|-------|-------------|--------------|
| Payment Success | ✅ Payment Confirmed! Machine is ready... | ✅ Paiement Confirmé! La machine est prête... |
| Payment Failed | ❌ Payment Failed. Please try again. | ❌ Paiement Échoué. Veuillez réessayer. |
| Cycle Completed | 🎉 Your laundry is ready! | 🎉 Votre linge est prêt! |
| Feedback Request | ⭐ How was your experience? | ⭐ Comment était votre expérience? |

## Customer Feedback System

Feedback is requested 30 minutes after cycle completion to give customers time to collect their laundry.

```mermaid
sequenceDiagram
    participant User as Customer
    participant Bot as WhatsApp Bot
    participant Monitor as Feedback Monitor
    participant Staff as Staff Phone

    Note over User,Staff: 30 minutes after cycle completion
    Monitor->>Monitor: Check for completed cycles ready for feedback
    Monitor->>Bot: Transaction X ready for feedback
    Bot->>User: "⭐ How was your experience?"
    Bot->>User: Rating buttons: ⭐⭐⭐⭐⭐ / ⭐⭐⭐⭐ / ⭐⭐⭐
    Bot->>User: Rating buttons: ⭐⭐ / ⭐ / Skip

    alt Rating 3-5 (Good)
        User->>Bot: Clicks ⭐⭐⭐⭐⭐
        Bot->>User: "🙏 Thank you! See you next time!"
    else Rating 1-2 (Poor)
        User->>Bot: Clicks ⭐⭐
        Bot->>User: "What went wrong? (optional comment)"
        User->>Bot: "Machine was dirty"
        Bot->>User: "📝 Comment received. Thank you!"
        Bot->>Staff: "⚠️ LOW RATING ALERT - Machine: Washer 01, Rating: 2/5"
    end
```

### Feedback Configuration

| Setting | Value | Description |
|---------|-------|-------------|
| `FEEDBACK_DELAY_MINUTES` | 30 | Time after cycle completion before feedback request |
| `STAFF_ALERT_PHONE` | env variable | Phone number for low rating alerts |
| Low rating threshold | 1-2 stars | Triggers staff alert |

### Feedback Data Model

```javascript
// Added to Transaction schema
feedback: {
    rating: Number,        // 1-5 stars
    comment: String,       // Optional, max 200 chars
    submittedAt: Date,
    staffAlertSent: Boolean
}
feedbackRequestSent: Boolean
feedbackRequestedAt: Date
```

## Race Condition Protection

When two users try to select the same machine simultaneously:

```
┌─────────────────────────────────────────────────────────────────┐
│  Machine Availability Check (getMachinesStatus)                 │
├─────────────────────────────────────────────────────────────────┤
│  A machine is marked UNAVAILABLE if:                            │
│                                                                 │
│  1. cycleStatus = 'IN_PROGRESS' AND cycleEndsAt > now          │
│     → Machine is running an active wash cycle                   │
│                                                                 │
│  2. status = 'PENDING' AND createdAt > (now - 5 minutes)       │
│     → Someone initiated payment but hasn't completed yet        │
│                                                                 │
│  This prevents two users from paying for the same machine!      │
│                                                                 │
│  Timeline:                                                      │
│  ├─ User A selects machine → PENDING transaction created        │
│  ├─ User B tries to select → Machine shows UNAVAILABLE          │
│  ├─ 5 minutes pass with no payment...                           │
│  └─ Machine becomes AVAILABLE again (auto-unlock)               │
└─────────────────────────────────────────────────────────────────┘
```

## Simplified Flow Chart

```
                    ┌──────────────┐
                    │   START      │
                    │ (new user)   │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │   LANGUAGE   │
                    │  SELECTION   │
                    │ (EN / FR)    │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │  MAIN_MENU   │◄─────────────────┐
                    │  (Welcome)   │                  │
                    └──────┬───────┘                  │
                           │                         │
                    ┌──────▼───────┐                  │
                    │   AWAITING   │                  │
                    │ MENU_CHOICE  │──────────────────┤ cancel
                    └──────┬───────┘                  │
                           │                         │
           ┌───────────────┼───────────────┐         │
           │               │               │         │
    ┌──────▼─────┐  ┌──────▼─────┐  ┌──────▼─────┐   │
    │  Services  │  │  My Status │  │ Start Wash │   │
    │   (info)   │  │  (check)   │  │            │   │
    └──────┬─────┘  └──────┬─────┘  └──────┬─────┘   │
           │               │               │         │
           └───────────────┴───────┬───────┘         │
                                   │                 │
                           ┌───────▼───────┐         │
                           │ SELECT_MACHINE │─────────┤ cancel
                           │    METHOD     │         │
                           └───────┬───────┘         │
                                   │                 │
                    ┌──────────────┴──────────────┐  │
                    │                             │  │
             ┌──────▼──────┐               ┌──────▼──────┐
             │ Enter ID    │               │ Choose List │
             │ manually    │               │             │
             └──────┬──────┘               └──────┬──────┘
                    │                             │
                    └──────────────┬──────────────┘
                                   │
                           ┌───────▼───────┐
                           │ SELECT_CYCLE  │──────────┤ cancel
                           │ (30/60 min)   │         │
                           └───────┬───────┘         │
                                   │                 │
                           ┌───────▼───────┐         │
                           │   PAYMENT     │         │
                           │  PROCESSING   │         │
                           └───────┬───────┘         │
                                   │                 │
                           ┌───────▼───────┐         │
                           │ clearSession()│─────────┘
                           │ (wait for     │
                           │  user input)  │
                           └───────────────┘

Note: Returning users (with language already set) skip directly to MAIN_MENU
```

## Backend Services Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Backend Services                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐   ┌─────────────────┐   ┌────────────────┐ │
│  │ WhatsApp        │   │ Payment         │   │ Cycle Monitor  │ │
│  │ Handler         │   │ Webhook         │   │ Service        │ │
│  │                 │   │ Controller      │   │ (Background)   │ │
│  │ - State machine │   │                 │   │                │ │
│  │ - Button menus  │   │ - Campay hooks  │   │ - Runs every   │ │
│  │ - User sessions │   │ - MTN hooks     │   │   60 seconds   │ │
│  │ - i18n (EN/FR)  │   │ - Send confirm  │   │ - Check cycles │ │
│  └────────┬────────┘   │   messages      │   │ - Send alerts  │ │
│           │            └────────┬────────┘   └───────┬────────┘ │
│           │                     │                    │          │
│           └─────────────────────┴────────────────────┘          │
│                                 │                               │
│                        ┌────────▼────────┐                      │
│                        │    MongoDB      │                      │
│                        │  Transactions   │                      │
│                        │                 │                      │
│                        │ - status        │                      │
│                        │ - cycleStatus   │                      │
│                        │ - cycleEndsAt   │                      │
│                        │ - notified flag │                      │
│                        └─────────────────┘                      │
└─────────────────────────────────────────────────────────────────┘
```
