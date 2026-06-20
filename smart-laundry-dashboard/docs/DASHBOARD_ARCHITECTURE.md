# 🎛️ Smart Laundry Management Dashboard - Architecture

## Overview

A unified management dashboard that aggregates data from all sources (machines, payments, operations) into a single view for business management, accounting, and tax preparation.

---

## 🎯 Goals

1. **Single Source of Truth** - All business data in one place
2. **Real-time Monitoring** - Live machine status and revenue tracking
3. **Financial Reporting** - Ready for accountant and tax preparation
4. **Maintenance Tracking** - Proactive machine maintenance
5. **Business Intelligence** - Insights to optimize operations

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         MANAGEMENT DASHBOARD                            │
│                        (React/Next.js Web App)                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          BACKEND API LAYER                              │
│                         (Node.js/TypeScript)                            │
│                                                                         │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐       │
│  │  Machines   │ │  Payments   │ │  Reports    │ │ Maintenance │       │
│  │  Service    │ │  Aggregator │ │  Generator  │ │  Tracker    │       │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘       │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
            ┌───────────────────────┼───────────────────────┐
            ▼                       ▼                       ▼
┌───────────────────┐   ┌───────────────────┐   ┌───────────────────┐
│   INTERNAL DATA   │   │  PAYMENT APIS     │   │   MACHINE DATA    │
│                   │   │                   │   │                   │
│  ┌─────────────┐  │   │  ┌─────────────┐  │   │  ┌─────────────┐  │
│  │ PostgreSQL  │  │   │  │   CamPay    │  │   │  │   ESP32     │  │
│  │ - Transactions│ │   │  │   API       │  │   │  │   MQTT      │  │
│  │ - Users     │  │   │  └─────────────┘  │   │  │   Status    │  │
│  │ - Machines  │  │   │  ┌─────────────┐  │   │  └─────────────┘  │
│  │ - Logs      │  │   │  │  MTN MoMo   │  │   │                   │
│  └─────────────┘  │   │  │   API       │  │   │                   │
│                   │   │  └─────────────┘  │   │                   │
│  ┌─────────────┐  │   │  ┌─────────────┐  │   │                   │
│  │   Redis     │  │   │  │   Orange    │  │   │                   │
│  │   Cache     │  │   │  │   API       │  │   │                   │
│  └─────────────┘  │   │  └─────────────┘  │   │                   │
│                   │   │  ┌─────────────┐  │   │                   │
│                   │   │  │   Wave      │  │   │                   │
│                   │   │  │   API       │  │   │                   │
│                   │   │  └─────────────┘  │   │                   │
└───────────────────┘   └───────────────────┘   └───────────────────┘
```

---

## 📊 Dashboard Modules

### 1. 📈 Revenue Dashboard

**Features:**
- Real-time revenue tracking (today, week, month, year)
- Revenue by payment provider (pie chart)
- Revenue by program type (Express/Standard/Intensif)
- Revenue by machine
- Comparison with previous periods
- Revenue trends and forecasts

**Data Sources:**
- Internal PostgreSQL (transactions table)
- Payment provider APIs (for reconciliation)

```typescript
interface RevenueSummary {
  today: number;
  thisWeek: number;
  thisMonth: number;
  thisYear: number;
  
  byProvider: {
    campay: number;
    mtn: number;
    orange: number;
    wave: number;
    nkwa: number;
  };
  
  byProgram: {
    express: { count: number; revenue: number };
    standard: { count: number; revenue: number };
    intensif: { count: number; revenue: number };
  };
  
  byMachine: {
    [machineId: string]: { cycles: number; revenue: number };
  };
}
```

### 2. 🧺 Machine Monitoring

**Features:**
- Real-time status of all 10 machines (6 washers + 4 dryers)
- Current cycle progress and time remaining
- Machine utilization rates
- Error alerts and history
- Cycle counts per machine
- Average cycles per day

**Data Sources:**
- MQTT real-time status
- PostgreSQL (machine_usage_logs)

```typescript
interface MachineStatus {
  id: string;
  type: 'washer' | 'dryer';
  name: string;
  
  status: 'available' | 'in_use' | 'completing' | 'error' | 'maintenance' | 'offline';
  currentProgram?: string;
  timeRemaining?: number;
  
  // Statistics
  totalCycles: number;
  cyclesThisMonth: number;
  cyclesToday: number;
  
  // Health
  lastMaintenance?: Date;
  cyclesSinceMaintenance: number;
  errorCount: number;
  lastError?: { code: string; message: string; date: Date };
  
  // Utilization
  utilizationRate: number; // percentage
  averageCyclesPerDay: number;
}
```

### 3. 🔧 Maintenance Tracker

**Features:**
- Maintenance schedule per machine
- Alerts when maintenance is due (based on cycle count or time)
- Maintenance history log
- Cost tracking for repairs
- Spare parts inventory (optional)

**Rules:**
- Alert at 500 cycles since last maintenance
- Alert every 3 months regardless of cycles
- Track all repairs with cost

```typescript
interface MaintenanceRecord {
  id: string;
  machineId: string;
  date: Date;
  type: 'scheduled' | 'repair' | 'emergency';
  description: string;
  cost: number;
  technicianName?: string;
  partsReplaced?: string[];
  cycleCountAtMaintenance: number;
  nextScheduledDate?: Date;
}

interface MaintenanceAlert {
  machineId: string;
  machineName: string;
  alertType: 'cycles' | 'time' | 'error_frequency';
  message: string;
  severity: 'low' | 'medium' | 'high';
  cyclesSinceMaintenance: number;
  daysSinceMaintenance: number;
}
```

### 4. 💳 Payment Reconciliation

**Features:**
- Aggregate transactions from all payment providers
- Compare internal records vs provider records
- Flag discrepancies for investigation
- Settlement tracking (when money arrives in bank)
- Fee calculation per provider

**Integration Approach:**

```typescript
// Payment Provider Integration Strategy

interface PaymentProviderIntegration {
  provider: string;
  
  // Option A: API Integration (preferred)
  hasAPI: boolean;
  apiEndpoints?: {
    listTransactions: string;
    getBalance: string;
    getSettlements: string;
  };
  
  // Option B: Manual Import
  supportsExport: boolean;
  exportFormat?: 'csv' | 'xlsx' | 'pdf';
  
  // Reconciliation
  reconciliationFrequency: 'realtime' | 'daily' | 'manual';
}

const PROVIDER_CAPABILITIES = {
  campay: {
    hasAPI: true,
    apiEndpoints: {
      listTransactions: '/api/transactions',
      getBalance: '/api/balance',
    },
    reconciliationFrequency: 'realtime'
  },
  mtn: {
    hasAPI: true,
    apiEndpoints: {
      listTransactions: '/collection/v1_0/accountholder/transactions',
    },
    reconciliationFrequency: 'daily'
  },
  orange: {
    hasAPI: true,
    // Similar to MTN
    reconciliationFrequency: 'daily'
  },
  wave: {
    hasAPI: true,
    apiEndpoints: {
      listTransactions: '/v1/transactions',
    },
    reconciliationFrequency: 'realtime'
  },
  nkwa: {
    hasAPI: true,
    reconciliationFrequency: 'daily'
  }
};
```

### 5. 📑 Financial Reports

**Features:**
- Daily/Weekly/Monthly/Annual summaries
- Export to Excel/PDF for accountant
- Tax-ready reports (VAT calculation if applicable)
- Expense tracking (electricity, water, maintenance, supplies)
- Profit & Loss statement
- Cash flow report

**Report Types:**

```typescript
interface FinancialReport {
  period: {
    start: Date;
    end: Date;
    type: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual';
  };
  
  revenue: {
    gross: number;
    byService: {
      laundry: number;
      cafe: number;
    };
    byPaymentProvider: Record<string, number>;
    transactionCount: number;
  };
  
  expenses: {
    electricity: number;
    water: number;
    maintenance: number;
    supplies: number;  // detergent, cafe supplies
    rent: number;
    staff: number;
    paymentFees: number;  // fees charged by payment providers
    other: number;
  };
  
  fees: {
    campay: { transactions: number; totalFees: number; feeRate: number };
    mtn: { transactions: number; totalFees: number; feeRate: number };
    // ... other providers
  };
  
  summary: {
    grossRevenue: number;
    totalExpenses: number;
    paymentFees: number;
    netRevenue: number;
    profitMargin: number;
  };
  
  // For tax purposes
  tax: {
    vatCollected?: number;
    vatRate?: number;
    taxableIncome: number;
  };
}
```

### 6. ☕ Café Sales Tracking (Optional Module)

**Features:**
- Track café sales separately
- Inventory management for café items
- Popular items analysis
- Café revenue contribution

```typescript
interface CafeSale {
  id: string;
  date: Date;
  items: Array<{
    name: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
  paymentMethod: string;
  total: number;
}
```

---

## 🔐 Access Control

```typescript
enum UserRole {
  OWNER = 'owner',           // Full access
  MANAGER = 'manager',       // Operations + Reports (no settings)
  STAFF = 'staff',           // Machine monitoring only
  ACCOUNTANT = 'accountant'  // Reports only (read-only)
}

const ROLE_PERMISSIONS = {
  owner: ['*'],  // All permissions
  
  manager: [
    'dashboard:view',
    'machines:view',
    'machines:control',
    'transactions:view',
    'reports:view',
    'reports:export',
    'maintenance:view',
    'maintenance:create',
  ],
  
  staff: [
    'dashboard:view',
    'machines:view',
    'machines:control',
    'transactions:view',
  ],
  
  accountant: [
    'reports:view',
    'reports:export',
    'transactions:view',
  ]
};
```

---

## 📱 Dashboard UI Components

### Main Navigation

```
┌─────────────────────────────────────────────────────────────────┐
│  🧺 Smart Laundry Manager                    👤 Admin  │ 🔔 3  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  📊 Dashboard                                                   │
│  🧺 Machines                                                    │
│  💳 Transactions                                                │
│  📈 Revenue                                                     │
│  🔧 Maintenance                                                 │
│  📑 Reports                                                     │
│  ☕ Café (optional)                                             │
│  ⚙️ Settings                                                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Dashboard Home (Overview)

```
┌─────────────────────────────────────────────────────────────────┐
│  📊 Dashboard                                      Dec 18, 2025 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │ 💰 Today │ │ 🧺 Active│ │ ⚠️ Alerts│ │ 📈 Month │          │
│  │ 45,000   │ │    3     │ │    2     │ │ 1.2M     │          │
│  │ FCFA     │ │ machines │ │ issues   │ │ FCFA     │          │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘          │
│                                                                 │
│  ┌─────────────────────────────────────┐ ┌─────────────────┐   │
│  │ 🧺 Machine Status                   │ │ 💳 Recent       │   │
│  │                                     │ │ Transactions    │   │
│  │  W1 ✅  W2 🔄 25m  W3 ✅  W4 🔄 10m │ │                 │   │
│  │  W5 ✅  W6 ⚠️ err  D1 ✅  D2 ✅    │ │  12:45 3,000F  │   │
│  │  D3 🔄 15m  D4 ✅                   │ │  12:30 2,500F  │   │
│  │                                     │ │  12:15 4,000F  │   │
│  └─────────────────────────────────────┘ │  12:00 3,000F  │   │
│                                          └─────────────────┘   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 📈 Revenue This Week                                    │   │
│  │  ████████████████████████████░░░░░░░░░░  320K / 500K   │   │
│  │  Mon  Tue  Wed  Thu  Fri  Sat  Sun                     │   │
│  │   45   52   48   55   60   70   --                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Technical Implementation

### Tech Stack Recommendation

| Layer | Technology | Reason |
|-------|------------|--------|
| **Frontend** | Next.js + React | Fast, SSR, easy deployment |
| **UI Components** | Tailwind + shadcn/ui | Modern, responsive |
| **Charts** | Recharts or Chart.js | Good for dashboards |
| **Backend** | Existing Node.js API | Reuse current backend |
| **Database** | Existing PostgreSQL | All data already there |
| **Real-time** | Socket.io or SSE | Live machine updates |
| **Auth** | JWT (existing) | Reuse current auth |
| **Export** | ExcelJS, PDFKit | Report generation |

### New API Endpoints Needed

```typescript
// Dashboard API Routes

// Overview
GET  /api/admin/dashboard/summary
GET  /api/admin/dashboard/stats?period=today|week|month

// Machines
GET  /api/admin/machines                    // All machines with status
GET  /api/admin/machines/:id/history        // Usage history
GET  /api/admin/machines/:id/maintenance    // Maintenance records

// Transactions
GET  /api/admin/transactions                // Paginated list
GET  /api/admin/transactions/export         // Export to Excel
GET  /api/admin/transactions/reconcile      // Reconciliation report

// Revenue
GET  /api/admin/revenue/summary             // Revenue overview
GET  /api/admin/revenue/by-provider         // Breakdown by provider
GET  /api/admin/revenue/by-program          // Breakdown by program
GET  /api/admin/revenue/trends              // Historical trends

// Maintenance
GET  /api/admin/maintenance/alerts          // Current alerts
GET  /api/admin/maintenance/schedule        // Upcoming maintenance
POST /api/admin/maintenance/log             // Log maintenance done
GET  /api/admin/maintenance/history         // Past maintenance

// Reports
GET  /api/admin/reports/daily/:date
GET  /api/admin/reports/monthly/:year/:month
GET  /api/admin/reports/annual/:year
GET  /api/admin/reports/tax/:year           // Tax-ready report
POST /api/admin/reports/export              // Generate PDF/Excel

// Expenses (manual entry)
GET  /api/admin/expenses
POST /api/admin/expenses
PUT  /api/admin/expenses/:id

// Settings
GET  /api/admin/settings
PUT  /api/admin/settings
```

---

## 📅 Implementation Phases

### Phase 1: Core Dashboard (Week 1-2)
- [ ] Dashboard home with summary cards
- [ ] Real-time machine status
- [ ] Basic transaction list
- [ ] Simple revenue chart

### Phase 2: Financial Reports (Week 3-4)
- [ ] Daily/Monthly reports
- [ ] Export to Excel
- [ ] Revenue by provider breakdown
- [ ] Basic expense tracking

### Phase 3: Maintenance Module (Week 5)
- [ ] Maintenance alerts
- [ ] Maintenance logging
- [ ] Cycle tracking per machine

### Phase 4: Advanced Features (Week 6+)
- [ ] Payment reconciliation
- [ ] Tax reports
- [ ] Multi-user access
- [ ] Café module (if needed)

---

## 💡 Integration with Payment Provider Dashboards

### Option A: API Integration (Recommended)

Pull transaction data directly from provider APIs:

```typescript
// Reconciliation Service
class ReconciliationService {
  async reconcileProvider(provider: string, dateRange: DateRange) {
    // 1. Get our internal records
    const internalTxns = await this.getInternalTransactions(provider, dateRange);
    
    // 2. Get provider records via API
    const providerTxns = await this.getProviderTransactions(provider, dateRange);
    
    // 3. Compare and flag discrepancies
    const discrepancies = this.findDiscrepancies(internalTxns, providerTxns);
    
    return {
      internal: internalTxns.length,
      provider: providerTxns.length,
      matched: internalTxns.length - discrepancies.length,
      discrepancies
    };
  }
}
```

### Option B: Manual CSV Import

For providers without good APIs:

```typescript
// CSV Import endpoint
POST /api/admin/reconciliation/import
Content-Type: multipart/form-data

{
  provider: 'mtn',
  file: <CSV file from provider dashboard>
}
```

### Option C: Iframe/Link to Provider Dashboard

Quick access links to provider dashboards:

```typescript
const PROVIDER_DASHBOARD_LINKS = {
  campay: 'https://dashboard.campay.net',
  mtn: 'https://momodeveloper.mtn.com/dashboard',
  orange: 'https://developer.orange.com/dashboard',
  wave: 'https://business.wave.com/dashboard',
};
```

---

## ✅ Benefits Summary

| Benefit | Impact |
|---------|--------|
| **Time Saved** | 2-3 hours/week on manual reconciliation |
| **Accuracy** | Eliminate human error in calculations |
| **Tax Prep** | Reports ready for accountant |
| **Maintenance** | Prevent costly breakdowns |
| **Insights** | Optimize pricing and operations |
| **Scalability** | Ready for multiple locations |

---

## 🎯 Recommendation

**YES, build the management dashboard!**

It's essential for:
1. ✅ Daily operations monitoring
2. ✅ Month-end accounting
3. ✅ Tax compliance
4. ✅ Proactive maintenance
5. ✅ Business growth decisions

**Start with Phase 1-2** (core dashboard + reports) and add features as needed.

---

*Document created: December 2024*
*For: Smart Laundry & Café Lounge - Douala*
