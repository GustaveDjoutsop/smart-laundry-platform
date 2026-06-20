# Payment Flow Documentation

This document explains the complete flow when a customer pays for using a washing machine or dryer in the Smart Laundromat system.

## Overview

The payment system integrates with mobile money providers (CamPay, MTN MoMo) via webhooks. When a customer initiates a payment, the system:
1. Creates a pending transaction
2. Waits for payment confirmation via webhook
3. Triggers the machine to start
4. Updates machine status in real-time
5. Notifies the customer via WhatsApp

## Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PAYMENT FLOW                                       │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  1. PAYMENT INITIATION                                                       │
│     Customer sends request via WhatsApp or API                               │
│                                                                              │
│     POST /api/pay                                                            │
│     Body: { phone, amount, machineId, pulseCount, cycleDuration }            │
│                                                                              │
│     Files: paymentController.js → campayService.js                           │
│                                                                              │
│     Actions:                                                                 │
│     • Validate machine is not already in use (race condition protection)    │
│     • Check for pending payments within 5 min timeout window                 │
│     • Create Transaction record:                                             │
│         - status = 'PENDING'                                                 │
│         - cycleStatus = 'NOT_STARTED'                                        │
│     • Call CamPay/MTN API to request payment from customer's mobile money    │
│     • Return reference ID to caller                                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  2. CUSTOMER APPROVES PAYMENT                                                │
│     Customer receives prompt on their phone and enters PIN                   │
│                                                                              │
│     The payment provider (CamPay/MTN) processes the transaction and sends   │
│     a webhook callback to our server with the result.                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  3. WEBHOOK RECEIVED                                                         │
│     POST /api/webhook/campay  or  POST /api/webhook/mtn                      │
│                                                                              │
│     File: webhookController.js                                               │
│                                                                              │
│     If status === 'SUCCESSFUL':                                              │
│     • Race condition check (verify no other cycle claimed this machine)      │
│     • Atomic update Transaction (only if still PENDING):                     │
│         - status = 'SUCCESSFUL'                                              │
│         - cycleStatus = 'IN_PROGRESS'                                        │
│         - cycleStartedAt = now                                               │
│         - cycleEndsAt = now + cycleDuration                                  │
│     • Call triggerMachine(machineId, pulseCount)                             │
│     • Send WhatsApp confirmation to customer                                 │
│                                                                              │
│     If status === 'FAILED':                                                  │
│     • Update Transaction status to 'FAILED'                                  │
│     • Store failure reason                                                   │
│     • Send WhatsApp failure notification to customer                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  4. TRIGGER MACHINE                                                          │
│     Files: mqttHandler.js → mqttService.js                                   │
│                                                                              │
│     triggerPulse(machineId, pulseCount)                                      │
│                                                                              │
│     Two paths depending on environment:                                      │
│                                                                              │
│     A) Production (Real MQTT Broker):                                        │
│        • Publishes to MQTT topic: laundry/cameroon/{machineId}/command       │
│        • Payload: { action: "pulse", count: pulseCount }                     │
│        • Real machine receives command and starts cycle                      │
│                                                                              │
│     B) Test Environment (Embedded Simulator):                                │
│        • Notifies registered command handlers                                │
│        • Simulator's handleCommand() receives the pulse command              │
│        • Simulator updates machine state internally                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  5. SIMULATOR PROCESSES COMMAND (Test Environment Only)                      │
│     File: embeddedSimulator.js                                               │
│                                                                              │
│     handleCommand(machineId, { action: 'pulse' })                            │
│                                                                              │
│     If machine status is 'IDLE':                                             │
│     • startCycle(machineId)                                                  │
│     • Set machine state:                                                     │
│         - status = 'RUNNING'                                                 │
│         - currentCycle.type = selected cycle type                            │
│         - currentCycle.startedAt = now                                       │
│         - currentCycle.duration = cycle duration in minutes                  │
│         - currentCycle.progress = 0                                          │
│     • Increment maintenance.totalCycles                                      │
│     • Increment maintenance.cyclesSinceService                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  6. TELEMETRY UPDATES (Continuous - Every 5 seconds)                         │
│     Files: embeddedSimulator.js → mqttService.js → Machine model             │
│                                                                              │
│     The simulator (or real machine) publishes telemetry data:                │
│     • status (IDLE, RUNNING, PAUSED, FINISHED, ERROR, MAINTENANCE, OFFLINE)  │
│     • currentCycle (type, progress, remainingTime)                           │
│     • telemetry (temperature, waterLevel, spinSpeed, vibration, etc.)        │
│     • maintenance (totalCycles, cyclesSinceService)                          │
│     • isOnline, lastHeartbeat                                                │
│                                                                              │
│     mqttService.processTelemetry() receives the data and:                    │
│     • Updates the Machine collection in MongoDB via findOneAndUpdate         │
│     • Uses upsert: true to create machine record if it doesn't exist         │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  7. CYCLE COMPLETION                                                         │
│     File: embeddedSimulator.js (updateRunningCycles method)                  │
│                                                                              │
│     When cycle progress reaches 100%:                                        │
│     • Set status = 'FINISHED'                                                │
│     • Reset telemetry values to idle state                                   │
│     • After 30 seconds, auto-transition to status = 'IDLE'                   │
│                                                                              │
│     File: cycleMonitorService.js                                             │
│     • Monitors Transaction.cycleEndsAt timestamps                            │
│     • Updates cycleStatus to 'COMPLETED' when cycle time expires             │
│     • Triggers feedback request to customer via WhatsApp                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  8. DASHBOARD READS DATA                                                     │
│     GET /api/admin/machines                                                  │
│                                                                              │
│     File: adminController.js (getMachines function)                          │
│                                                                              │
│     Queries multiple data sources:                                           │
│     • Machine collection → status, totalCycles, telemetry, maintenance       │
│     • Transaction collection → active cycles (cycleStatus = 'IN_PROGRESS')   │
│     • Transaction aggregation → today's cycles, this month's cycles          │
│                                                                              │
│     Maps database status to frontend status:                                 │
│     • RUNNING → 'in_use'                                                     │
│     • FINISHED → 'completing'                                                │
│     • ERROR → 'error'                                                        │
│     • MAINTENANCE → 'maintenance'                                            │
│     • OFFLINE → 'offline'                                                    │
│     • IDLE/PAUSED → 'available'                                              │
│     • Has active transaction → 'in_use' (overrides DB status)                │
│     • Has pending payment → 'reserved'                                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Key Files

| File | Purpose |
|------|---------|
| `controllers/paymentController.js` | Handles payment initiation API |
| `services/campayService.js` | CamPay API integration, transaction creation |
| `services/mtnService.js` | MTN MoMo API integration |
| `controllers/webhookController.js` | Processes payment webhooks from providers |
| `handlers/mqttHandler.js` | Routes commands to MQTT service |
| `services/mqttService.js` | MQTT communication, telemetry processing |
| `simulator/embeddedSimulator.js` | Test environment machine simulator |
| `services/cycleMonitorService.js` | Monitors cycle completion, triggers feedback |
| `controllers/adminController.js` | Dashboard API endpoints |
| `models/Transaction.js` | Transaction data model |
| `models/Machine.js` | Machine telemetry data model |

## Data Models

### Transaction Status Flow
```
PENDING → SUCCESSFUL → (cycle runs) → cycleStatus: COMPLETED
    │
    └→ FAILED (if payment fails)
```

### Machine Status Values
| Status | Description |
|--------|-------------|
| `IDLE` | Machine available for use |
| `RUNNING` | Cycle in progress |
| `PAUSED` | Cycle paused (rare) |
| `FINISHED` | Cycle complete, waiting for customer |
| `ERROR` | Machine has an error |
| `MAINTENANCE` | Under maintenance |
| `OFFLINE` | Machine not responding |

## Race Condition Protection

The system includes multiple safeguards against race conditions:

1. **Before Payment Initiation** (`campayService.js`):
   - Check for existing active cycle on the machine
   - Check for pending payments within 5-minute window

2. **On Webhook Receipt** (`webhookController.js`):
   - Check if another transaction claimed the machine while payment was processing
   - Use atomic `findOneAndUpdate` with `status: 'PENDING'` condition
   - Only the first successful webhook will claim the machine

3. **Failure Handling**:
   - If race condition detected, transaction is marked as FAILED
   - Customer is notified via WhatsApp about the refund

## Environment Configuration

### Test Environment (Simulator)
```yaml
simulator:
  enabled: true
  telemetry_interval: 5000  # ms
```

When the simulator is enabled:
- MQTT broker connection is skipped
- Embedded simulator handles all machine operations
- Commands are routed via `mqttService.onCommand()` handlers
- Telemetry is processed via `mqttService.handleSimulatedTelemetry()`

### Production Environment
- Real MQTT broker connection
- Commands published to `laundry/cameroon/{machineId}/command`
- Telemetry received from `laundry/cameroon/{machineId}/telemetry`
- Real machines respond to pulse commands

## WhatsApp Notifications

The system sends WhatsApp messages at key points:

1. **Payment Confirmed**: Machine name, duration, estimated end time
2. **Payment Failed**: Machine name, failure reason
3. **Race Condition**: Notification that another payment claimed the machine
4. **Cycle Complete**: Feedback request with star rating buttons

## Troubleshooting

### Machine shows wrong status on dashboard
- Check if simulator is running (`[Simulator]` logs in console)
- Verify `mqttService.onCommand()` is wired up in `server.js`
- Check Machine collection in MongoDB for latest telemetry

### Payment successful but machine didn't start
- Check webhook logs for `🚀 Pulse Sent` message
- Verify simulator received the command
- Check for errors in `handleCommand()` logs

### Telemetry not updating in database
- Verify MongoDB connection is active
- Check `processTelemetry()` logs for errors
- Ensure Machine model schema matches telemetry data structure
