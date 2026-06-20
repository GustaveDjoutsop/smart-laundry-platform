import axios from 'axios';
import type {
  MachineStatus,
  MachineStatusType,
  MachineType,
  Transaction,
  TransactionStatus,
  CycleStatus,
  PaymentProvider,
  MaintenanceRecord,
  MaintenanceType,
  MaintenanceStatus,
  MaintenancePriority,
  DashboardSummary,
  DashboardStats,
  RevenueSummary,
  RevenueByProvider,
  RevenueByProgram,
  RevenueByMachine,
  RevenueTrends,
  MaintenanceAlert,
  Expense,
  ExpenseCategory,
  PaymentMethod,
  DailyReport,
  MonthlyReport,
  ReconciliationResult,
  Discrepancy,
  FeedbackResponse,
  FeedbackAnalytics,
  FeedbackItem,
  User,
  UserRole,
  UserCreateInput,
  UserUpdateInput,
  SessionInfo,
  LoginHistoryEntry,
} from '@/types';

// ============================================
// Axios instances
// bffApi  — all /admin/* analytics/reporting → API gateway → Reporting BFF
// api     — legacy Express backend: auth, users, timekeeping, absences,
//           maintenance, expenses, QR-code endpoints (not yet in BFF)
// ============================================
const BFF_BASE_URL      = process.env.NEXT_PUBLIC_BFF_URL      || 'http://localhost:8080/reports/api';
const API_BASE_URL      = process.env.NEXT_PUBLIC_API_URL      || 'http://localhost:3000/api';
const PAYMENTS_BASE_URL = process.env.NEXT_PUBLIC_PAYMENTS_URL || 'http://localhost:8080/payments';

// Fetch the Auth0 access token client-side via the /auth/access-token route
// (served automatically by auth0.middleware). Falls back to null on error or SSR.
async function getAuth0Token(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  try {
    const { getAccessToken } = await import('@auth0/nextjs-auth0/client');
    return await getAccessToken();
  } catch {
    return null;
  }
}

function makeAxios(baseURL: string, timeout = 10_000) {
  const instance = axios.create({
    baseURL,
    timeout,
    headers: { 'Content-Type': 'application/json' },
  });

  instance.interceptors.request.use(
    async (config) => {
      const token = await getAuth0Token();
      if (token) config.headers.Authorization = `Bearer ${token}`;
      return config;
    },
    (error) => Promise.reject(error),
  );

  instance.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error.response?.status === 401 && typeof window !== 'undefined') {
        window.location.href = '/auth/login';
      }
      return Promise.reject(error);
    },
  );

  return instance;
}

const bffApi      = makeAxios(BFF_BASE_URL);
const api         = makeAxios(API_BASE_URL, 5_000);
const paymentsApi = makeAxios(PAYMENTS_BASE_URL);

// ============================================
// Private adapter helpers
// BFF returns snake_case Map keys from JDBC; CamelCaseResponseAdvice on the
// BFF side converts them to camelCase before the response reaches the client.
// These adapters handle structural differences (field renames, wrapping, etc.).
// ============================================
type AnyMap = Record<string, unknown>;

function n(v: unknown): number { return Number(v ?? 0); }
function s(v: unknown): string { return String(v ?? ''); }

function periodToDateRange(period: 'today' | 'week' | 'month' | 'year'): {
  startDate: string;
  endDate: string;
} {
  const now = new Date();
  const endDate = now.toISOString().split('T')[0];
  let startDate: string;
  switch (period) {
    case 'today':
      startDate = endDate;
      break;
    case 'week': {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      startDate = d.toISOString().split('T')[0];
      break;
    }
    case 'month':
      startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      break;
    case 'year':
      startDate = `${now.getFullYear()}-01-01`;
      break;
    default:
      startDate = endDate;
  }
  return { startDate, endDate };
}

// Dashboard summary: BFF { today, month, machines, pendingTransactions24h }
// → legacy DashboardSummary shape expected by pages
function adaptDashboardSummary(raw: AnyMap): DashboardSummary {
  const today    = (raw.today    ?? {}) as AnyMap;
  const month    = (raw.month    ?? {}) as AnyMap;
  const machines = (raw.machines ?? {}) as AnyMap;
  return {
    revenue: {
      today:              n(today.revenue),
      todayTransactions:  n(today.transactions),
      month:              n(month.revenue),
      monthTransactions:  n(month.transactions),
    },
    machines: {
      total:    n(machines.total),
      inUse:    n(machines.running),
      available: n(machines.idle),
    },
    alerts: {
      maintenance:  0,
      stalePending: n(raw.pendingTransactions24h),
      total:        n(raw.pendingTransactions24h),
    },
    // BFF summary does not query ops.feedback — populated on dashboard
    feedback: { averageRating: null, totalReviews: 0 },
  };
}

// Dashboard stats: BFF returns [{date, revenue, transactions, machinesUsed}]
function adaptDashboardStats(
  list: AnyMap[],
  period: 'today' | 'week' | 'month' | 'year',
): DashboardStats {
  const { startDate, endDate } = periodToDateRange(period);
  return {
    period,
    dateRange: { start: new Date(startDate), end: new Date(endDate) },
    revenueByDay: list.map((r) => ({
      _id:          s(r.date),
      revenue:      n(r.revenue),
      transactions: n(r.transactions),
    })),
    // MongoDB-specific aggregations not available in BFF yet
    transactionsByStatus: { PENDING: 0, SUCCESSFUL: 0, FAILED: 0 },
    usageByHour: [],
  };
}

// Revenue summary: BFF { totalRevenue, totalTransactions, avgTransaction, machinesUsed, prevRevenue, prevTransactions }
function adaptRevenueSummary(raw: AnyMap, period: string): RevenueSummary {
  const { startDate, endDate } = periodToDateRange(
    period as 'today' | 'week' | 'month' | 'year',
  );
  const currentTotal = n(raw.totalRevenue);
  const prevTotal    = n(raw.prevRevenue);
  const growthAmount = currentTotal - prevTotal;
  const growthPct    = prevTotal > 0 ? ((growthAmount / prevTotal) * 100).toFixed(1) : null;
  return {
    period,
    dateRange: { start: new Date(startDate), end: new Date(endDate) },
    current: {
      total:          currentTotal,
      transactions:   n(raw.totalTransactions),
      avgTransaction: n(raw.avgTransaction),
    },
    previous: {
      total:        prevTotal,
      transactions: n(raw.prevTransactions),
    },
    growth: { amount: growthAmount, percent: growthPct },
  };
}

function adaptRevenueByProvider(list: AnyMap[], period: string): RevenueByProvider {
  const { startDate, endDate } = periodToDateRange(
    period as 'today' | 'week' | 'month' | 'year',
  );
  const total = list.reduce((sum, r) => sum + n(r.revenue), 0);
  return {
    period,
    dateRange: { start: new Date(startDate), end: new Date(endDate) },
    providers: list.map((r) => ({
      provider:     s(r.provider ?? r.paymentProvider),
      revenue:      n(r.revenue),
      transactions: n(r.transactions),
      percentage:   total > 0 ? ((n(r.revenue) / total) * 100).toFixed(1) : '0.0',
    })),
    total,
  };
}

function adaptRevenueByProgram(list: AnyMap[], period: string): RevenueByProgram {
  const { startDate, endDate } = periodToDateRange(
    period as 'today' | 'week' | 'month' | 'year',
  );
  const total = list.reduce((sum, r) => sum + n(r.revenue), 0);
  return {
    period,
    dateRange: { start: new Date(startDate), end: new Date(endDate) },
    programs: list.map((r) => {
      const dur = n(r.durationMinutes);
      return {
        duration:     dur,
        name:         `${dur} min`,
        revenue:      n(r.revenue),
        transactions: n(r.transactions),
        percentage:   total > 0 ? ((n(r.revenue) / total) * 100).toFixed(1) : '0.0',
      };
    }),
    total,
  };
}

function adaptRevenueByMachine(list: AnyMap[], period: string): RevenueByMachine {
  const { startDate, endDate } = periodToDateRange(
    period as 'today' | 'week' | 'month' | 'year',
  );
  const total = list.reduce((sum, r) => sum + n(r.revenue), 0);
  return {
    period,
    dateRange: { start: new Date(startDate), end: new Date(endDate) },
    machines: list.map((r) => ({
      machineId:  s(r.machineId),
      name:       s(r.machineId),
      type:       s(r.machineType || 'WASHER').toLowerCase() as 'washer' | 'dryer',
      revenue:    n(r.revenue),
      cycles:     n(r.transactions),
      percentage: total > 0 ? ((n(r.revenue) / total) * 100).toFixed(1) : '0.0',
    })),
    total,
  };
}

function adaptRevenueTrends(list: AnyMap[], months: number): RevenueTrends {
  return {
    months,
    trends: list.map((r) => ({
      month:        s(r.period).substring(0, 7), // "2026-06-01" → "2026-06"
      revenue:      n(r.revenue),
      transactions: n(r.transactions),
    })),
  };
}

function adaptTransaction(r: AnyMap): Transaction {
  return {
    id:               s(r.id),
    externalReference: s(r.externalReference),
    amount:           n(r.amount),
    phoneNumber:      s(r.phoneNumber),
    machineId:        s(r.machineId),
    pulseCount:       n(r.pulseCount),
    cycleDuration:    n(r.cycleDuration),
    description:      r.description as string | undefined,
    status:           (r.status as TransactionStatus) || 'PENDING',
    cycleStatus:      (r.cycleStatus as CycleStatus)  || 'NOT_STARTED',
    cycleStartedAt:   r.cycleStartedAt
      ? new Date(r.cycleStartedAt as string)
      : undefined,
    cycleEndsAt: r.cycleEndsAt
      ? new Date(r.cycleEndsAt as string)
      : undefined,
    paymentProvider: (s(r.paymentProvider).toLowerCase() as PaymentProvider) || 'campay',
    failureReason:   r.failureReason as string | undefined,
    createdAt:       new Date(r.createdAt as string),
  };
}

function adaptTransactionList(raw: AnyMap): {
  transactions: Transaction[];
  pagination: { page: number; limit: number; total: number; pages: number };
} {
  const data = (raw.data as AnyMap[]) || [];
  return {
    transactions: data.map(adaptTransaction),
    pagination: {
      page:  n(raw.page),
      limit: n(raw.size),
      total: n(raw.total),
      pages: n(raw.totalPages),
    },
  };
}

function bffMachineStatus(status: string, hasActiveCycle: boolean): MachineStatusType {
  if (hasActiveCycle) return 'in_use';
  switch (status.toUpperCase()) {
    case 'RUNNING':     return 'in_use';
    case 'IDLE':        return 'available';
    case 'MAINTENANCE': return 'maintenance';
    case 'OFFLINE':     return 'offline';
    default:            return 'available';
  }
}

function adaptMachineRow(m: AnyMap): MachineStatus {
  const hasActiveCycle = !!m.activeCycleId;
  const endsAt = m.cycleEndsAt ? new Date(m.cycleEndsAt as string) : null;
  const remaining = endsAt
    ? Math.max(0, Math.round((endsAt.getTime() - Date.now()) / 60_000))
    : undefined;
  return {
    id:               s(m.machineId),
    type:             s(m.type || 'WASHER').toLowerCase() as MachineType,
    name:             s(m.machineId),
    status:           bffMachineStatus(s(m.status), hasActiveCycle),
    currentProgram:   hasActiveCycle ? 'Active cycle' : undefined,
    timeRemaining:    remaining,
    remainingMinutes: remaining,
    totalCycles:           0,
    cyclesThisMonth:       0,
    cyclesToday:           0,
    cyclesSinceMaintenance: 0,
    errorCount:            0,
    utilizationRate:       0,
    averageCyclesPerDay:   0,
  };
}

function adaptMachinesList(list: AnyMap[]): {
  machines: MachineStatus[];
  summary: { total: number; available: number; inUse: number; reserved: number };
} {
  const machines = list.map(adaptMachineRow);
  return {
    machines,
    summary: {
      total:     machines.length,
      available: machines.filter((m) => m.status === 'available').length,
      inUse:     machines.filter((m) => m.status === 'in_use').length,
      reserved:  0,
    },
  };
}

function adaptFeedbackItem(r: AnyMap): FeedbackItem {
  return {
    id:              s(r.id),
    transactionId:   s(r.transactionReference ?? r.transactionId),
    machineId:       s(r.machineId),
    machineName:     s(r.machineId),
    machineType:     'washer' as MachineType,
    customerPhone:   r.phoneNumber != null ? s(r.phoneNumber) : null,
    rating:          n(r.rating),
    comment:         r.comment != null ? s(r.comment) : null,
    submittedAt:     new Date(r.submittedAt as string),
    transactionDate: new Date(r.submittedAt as string),
    amount:          n(r.amount),
    cycleDuration:   n(r.cycleDuration),
    staffAlertSent:  Boolean(r.staffAlertSent),
  };
}

function adaptFeedbackList(raw: AnyMap): FeedbackResponse {
  const items = (raw.feedback   as AnyMap[]) || [];
  const stats  = (raw.stats     as AnyMap)   || {};
  const dist   = (raw.distribution as AnyMap[]) || [];
  return {
    feedback: items.map(adaptFeedbackItem),
    stats: {
      averageRating: stats.averageRating != null ? String(stats.averageRating) : null,
      totalReviews:  n(stats.totalReviews),
      withComments:  n(stats.withComments),
    },
    distribution: dist.map((d) => ({ rating: n(d.rating), count: n(d.count) })),
    pagination: {
      page:  n(raw.page),
      limit: n(raw.size),
      total: n(raw.total),
      pages: n(raw.totalPages),
    },
  };
}

function adaptFeedbackAnalytics(raw: AnyMap, period: string): FeedbackAnalytics {
  const { startDate, endDate } = periodToDateRange(
    period as 'today' | 'week' | 'month' | 'year',
  );
  const trend    = (raw.ratingTrend     as AnyMap[]) || [];
  const byMachine = (raw.ratingByMachine as AnyMap[]) || [];
  const alerts   = (raw.lowRatingAlerts  as AnyMap[]) || [];
  return {
    period,
    dateRange: { start: new Date(startDate), end: new Date(endDate) },
    trend: trend.map((t) => ({
      date:          s(t.period),
      averageRating: n(t.averageRating),
      count:         n(t.count),
    })),
    byMachine: byMachine.map((m) => ({
      machineId:     s(m.machineId),
      name:          s(m.machineId),
      type:          'washer' as MachineType,
      averageRating: n(m.averageRating),
      totalReviews:  n(m.totalReviews),
    })),
    lowRatingAlerts: alerts.map((a) => ({
      id:           s(a.id),
      machineId:    s(a.machineId),
      machineName:  s(a.machineId),
      rating:       n(a.rating),
      comment:      a.comment != null ? s(a.comment) : null,
      submittedAt:  new Date(a.submittedAt as string),
      customerPhone: a.phoneNumber != null ? s(a.phoneNumber) : null,
    })),
  };
}

function adaptReconciliation(raw: AnyMap): ReconciliationResult {
  const period      = (raw.period       as AnyMap) || {};
  const discrepancies = (raw.discrepancies as AnyMap[]) || [];
  return {
    dateRange: {
      start: new Date(s(period.startDate) || new Date().toISOString()),
      end:   new Date(s(period.endDate)   || new Date().toISOString()),
    },
    summary: {
      totalTransactions: n(raw.transactionCount),
      successful:        n(raw.transactionCount),
      failed:            0,
      pending:           0,
      totalRevenue:      n(raw.paymentTotal),
      failedAmount:      0,
    },
    discrepancies: discrepancies.map((d) => ({
      type:              'no_cycle_started' as const,
      transactionId:     s(d.id),
      externalReference: s(d.externalReference),
      amount:            n(d.amount),
      createdAt:         d.createdAt ? new Date(d.createdAt as string) : undefined,
      description:       `Payment with no cycle started: ${d.externalReference}`,
    })),
    discrepancyCount:       discrepancies.length,
    reconciliationStatus:   discrepancies.length === 0 ? 'OK' : 'NEEDS_ATTENTION',
  };
}

function adaptDailyReport(raw: AnyMap, date: string): DailyReport {
  const summary  = (raw.summary  as AnyMap) || {};
  const byMachine = (raw.byMachine as AnyMap[]) || [];
  return {
    date,
    revenue: {
      total:        n(summary.totalRevenue),
      transactions: n(summary.totalTransactions),
    },
    expenses:          0,
    profit:            n(summary.totalRevenue),
    failedTransactions: 0,
    byMachine: byMachine.map((m) => ({
      machineId: s(m.machineId),
      name:      s(m.machineId),
      revenue:   n(m.revenue),
      cycles:    n(m.transactions),
    })),
    byHour: [],
  };
}

function adaptMonthlyReport(raw: AnyMap): MonthlyReport {
  const summary    = (raw.summary    as AnyMap) || {};
  const dailyTrend = (raw.dailyTrend as AnyMap[]) || [];
  const year       = n(raw.year);
  const month      = n(raw.month);
  const startDate  = new Date(year, month - 1, 1);
  const endDate    = new Date(year, month, 0);
  return {
    year,
    month,
    dateRange: { start: startDate, end: endDate },
    revenue: {
      total:        n(summary.totalRevenue),
      transactions: n(summary.totalTransactions),
    },
    expenses:     { total: 0, byCategory: [] },
    profit:       n(summary.totalRevenue),
    profitMargin: '0',
    dailyRevenue: dailyTrend.map((d) => {
      const dateStr = s(d.period); // "2026-06-01"
      const day = parseInt(dateStr.split('-')[2] || '0', 10);
      return { day, revenue: n(d.revenue), transactions: n(d.transactions) };
    }),
  };
}

// ============================================
// Health Check API
// ============================================
export const healthApi = {
  check: async () => {
    const response = await api.get<{ status: string }>('/health');
    return response.data;
  },
};

// ============================================
// Dashboard API → BFF
// ============================================
export const dashboardApi = {
  getSummary: async (): Promise<DashboardSummary> => {
    const response = await bffApi.get<AnyMap>('/admin/dashboard/summary');
    return adaptDashboardSummary(response.data);
  },

  getStats: async (period: 'today' | 'week' | 'month' | 'year' = 'week'): Promise<DashboardStats> => {
    const { startDate, endDate } = periodToDateRange(period);
    const response = await bffApi.get<AnyMap[]>('/admin/dashboard/stats', {
      params: { startDate, endDate },
    });
    return adaptDashboardStats(response.data, period);
  },
};

// ============================================
// Machines API → BFF (read) + legacy (QR code URLs)
// ============================================
export const machinesApi = {
  getAll: async (): Promise<{
    machines: MachineStatus[];
    summary: { total: number; available: number; inUse: number; reserved: number };
  }> => {
    const response = await bffApi.get<AnyMap[]>('/admin/machines');
    return adaptMachinesList(response.data);
  },

  getById: async (id: string): Promise<{
    id: string;
    name: string;
    type: 'washer' | 'dryer';
    status: string;
    currentCycle: {
      startedAt: Date;
      endsAt: Date;
      remainingMinutes: number;
      customerPhone: string;
    } | null;
    monthStats: { revenue: number; cycles: number; avgCycleDuration: number };
    rating: { average: string | null; totalReviews: number };
    recentTransactions: Array<{
      id: string;
      date: Date;
      amount: number;
      status: string;
      cycleDuration: number;
    }>;
    maintenanceHistory: MaintenanceRecord[];
  }> => {
    const response = await bffApi.get<AnyMap>(`/admin/machines/${id}`);
    const m = response.data;
    const hasActiveCycle = !!m.activeCycleId;
    const endsAt = m.cycleEndsAt ? new Date(m.cycleEndsAt as string) : null;
    return {
      id:     s(m.machineId),
      name:   s(m.machineId),
      type:   s(m.type || 'WASHER').toLowerCase() as 'washer' | 'dryer',
      status: s(m.status),
      currentCycle: hasActiveCycle && endsAt ? {
        startedAt:        new Date(m.cycleStartedAt as string),
        endsAt,
        remainingMinutes: Math.max(0, Math.round((endsAt.getTime() - Date.now()) / 60_000)),
        customerPhone:    s(m.cycleCustomer),
      } : null,
      monthStats:         { revenue: 0, cycles: 0, avgCycleDuration: 0 },
      rating:             { average: null, totalReviews: 0 },
      recentTransactions: [],
      maintenanceHistory: [],
    };
  },

  getHistory: async (
    id: string,
    params?: { period?: string; page?: number; limit?: number },
  ): Promise<{
    machineId: string;
    period: string;
    dateRange: { start: Date; end: Date };
    transactions: Transaction[];
    dailyStats: Array<{ _id: string; revenue: number; cycles: number }>;
    pagination: { page: number; limit: number; total: number; pages: number };
  }> => {
    const response = await bffApi.get<AnyMap[]>(`/admin/machines/${id}/history`, {
      params: { limit: params?.limit ?? 50 },
    });
    const rows = response.data;
    const txns: Transaction[] = rows.map((r) => ({
      id:               s(r.id),
      externalReference: s(r.transactionReference),
      amount:           n(r.amount),
      phoneNumber:      s(r.phoneNumber),
      machineId:        id,
      pulseCount:       0,
      cycleDuration:    n(r.cycleDuration ?? 0),
      status:           'SUCCESSFUL' as TransactionStatus,
      cycleStatus:      (s(r.status || 'COMPLETED')) as CycleStatus,
      paymentProvider:  s(r.paymentProvider).toLowerCase() as PaymentProvider || 'campay',
      createdAt:        new Date(r.createdAt as string),
    }));
    return {
      machineId:  id,
      period:     params?.period ?? 'all',
      dateRange:  { start: new Date(0), end: new Date() },
      transactions: txns,
      dailyStats:   [],
      pagination:   { page: 0, limit: rows.length, total: rows.length, pages: 1 },
    };
  },

  getQRCodeUrl: async (machineId: string): Promise<{
    machineId: string;
    machineName: string;
    whatsappUrl: string;
    phoneNumber: string;
  }> => {
    const response = await api.get(`/admin/machines/${machineId}/qrcode-url`);
    return response.data;
  },

  getAllQRCodeUrls: async (): Promise<{
    phoneNumber: string;
    totalMachines: number;
    machines: Array<{ machineId: string; machineName: string; whatsappUrl: string }>;
  }> => {
    const response = await api.get('/admin/machines/qrcode-urls');
    return response.data;
  },
};

// ============================================
// Transactions API → BFF
// ============================================
export const transactionsApi = {
  getAll: async (params?: {
    page?: number;
    limit?: number;
    status?: 'PENDING' | 'SUCCESSFUL' | 'FAILED';
    machineId?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
  }): Promise<{
    transactions: Transaction[];
    pagination: { page: number; limit: number; total: number; pages: number };
  }> => {
    const { limit, ...rest } = params ?? {};
    const response = await bffApi.get<AnyMap>('/admin/transactions', {
      params: { ...rest, size: limit ?? 20 },
    });
    return adaptTransactionList(response.data);
  },

  getById: async (id: string): Promise<Transaction> => {
    const response = await bffApi.get<AnyMap>(`/admin/transactions/${id}`);
    return adaptTransaction(response.data);
  },

  // Export not yet in BFF — stays on legacy
  export: async (params?: { startDate?: string; endDate?: string; format?: 'csv' | 'json' }) => {
    const response = await api.get('/admin/transactions/export', {
      params,
      responseType: params?.format === 'csv' ? 'blob' : 'json',
    });
    return response.data;
  },
};

// ============================================
// Payment API → legacy (PaymentManagementService via Express proxy)
// ============================================
export const paymentApi = {
  initiate: async (data: {
    phone: string;
    amount: number;
    machineId: string;
    pulseCount: number;
  }): Promise<{ success: boolean; reference: string; ussdCode?: string }> => {
    const response = await api.post('/pay', data);
    return response.data;
  },
};

// ============================================
// Revenue API → BFF
// BFF uses startDate/endDate; adapter converts period string
// ============================================
export const revenueApi = {
  getSummary: async (period: 'today' | 'week' | 'month' | 'year' = 'month'): Promise<RevenueSummary> => {
    const { startDate, endDate } = periodToDateRange(period);
    const response = await bffApi.get<AnyMap>('/admin/revenue/summary', {
      params: { startDate, endDate },
    });
    return adaptRevenueSummary(response.data, period);
  },

  getByProvider: async (period: 'today' | 'week' | 'month' | 'year' = 'month'): Promise<RevenueByProvider> => {
    const { startDate, endDate } = periodToDateRange(period);
    const response = await bffApi.get<AnyMap[]>('/admin/revenue/by-provider', {
      params: { startDate, endDate },
    });
    return adaptRevenueByProvider(response.data, period);
  },

  getByProgram: async (period: 'today' | 'week' | 'month' | 'year' = 'month'): Promise<RevenueByProgram> => {
    const { startDate, endDate } = periodToDateRange(period);
    const response = await bffApi.get<AnyMap[]>('/admin/revenue/by-program', {
      params: { startDate, endDate },
    });
    return adaptRevenueByProgram(response.data, period);
  },

  getByMachine: async (period: 'today' | 'week' | 'month' | 'year' = 'month'): Promise<RevenueByMachine> => {
    const { startDate, endDate } = periodToDateRange(period);
    const response = await bffApi.get<AnyMap[]>('/admin/revenue/by-machine', {
      params: { startDate, endDate },
    });
    return adaptRevenueByMachine(response.data, period);
  },

  getTrends: async (months: number = 6): Promise<RevenueTrends> => {
    const endDate   = new Date().toISOString().split('T')[0];
    const startDate = new Date(
      new Date().setMonth(new Date().getMonth() - months),
    ).toISOString().split('T')[0];
    const response = await bffApi.get<AnyMap[]>('/admin/revenue/trends', {
      params: { granularity: 'month', startDate, endDate },
    });
    return adaptRevenueTrends(response.data, months);
  },
};

// ============================================
// Maintenance adapters
// ============================================
function adaptMaintenanceAlert(raw: AnyMap): MaintenanceAlert {
  return {
    id:                s(raw.id),
    machineId:         s(raw.machineId),
    type:              s(raw.type).toLowerCase() as MaintenanceType,
    status:            s(raw.status).toLowerCase() as MaintenanceStatus,
    priority:          s(raw.priority).toLowerCase() as MaintenancePriority,
    description:       s(raw.description),
    isAlert:           raw.isAlert === true || raw.isAlert === 'true',
    alertAcknowledged: raw.alertAcknowledged === true || raw.alertAcknowledged === 'true',
    createdAt:         new Date(s(raw.createdAt)),
  };
}

function adaptMaintenanceRecord(raw: AnyMap): MaintenanceRecord {
  return {
    id:                s(raw.id),
    machineId:         s(raw.machineId),
    type:              s(raw.type).toLowerCase() as MaintenanceType,
    status:            s(raw.status).toLowerCase() as MaintenanceStatus,
    priority:          s(raw.priority).toLowerCase() as MaintenancePriority,
    description:       s(raw.description),
    cost:              n(raw.cost),
    partsReplaced:     [],
    isAlert:           raw.isAlert === true,
    alertAcknowledged: raw.alertAcknowledged === true,
    createdAt:         new Date(s(raw.createdAt)),
    updatedAt:         raw.updatedAt ? new Date(s(raw.updatedAt)) : undefined,
  };
}

// ============================================
// Maintenance API → BFF
// ============================================
export const maintenanceApi = {
  getAlerts: async (): Promise<{ alerts: MaintenanceAlert[] }> => {
    const response = await bffApi.get<AnyMap[]>('/admin/maintenance/alerts');
    return { alerts: response.data.map(adaptMaintenanceAlert) };
  },

  getHistory: async (params?: {
    page?: number;
    limit?: number;
    machineId?: string;
    status?: string;
  }): Promise<{
    maintenance: MaintenanceRecord[];
    pagination: { page: number; limit: number; total: number; pages: number };
  }> => {
    const response = await bffApi.get<AnyMap[]>('/admin/maintenance/history', {
      params: { machineId: params?.machineId },
    });
    const records = response.data.map(adaptMaintenanceRecord);
    const page  = params?.page  ?? 1;
    const limit = params?.limit ?? 100;
    return {
      maintenance: records,
      pagination: { page, limit, total: records.length, pages: 1 },
    };
  },

  createLog: async (data: {
    machineId: string;
    type: 'preventive' | 'corrective' | 'emergency' | 'inspection';
    description: string;
    priority?: 'low' | 'medium' | 'high' | 'critical';
    notes?: string;
    cost?: number;
    performedBy?: string;
  }): Promise<{ maintenance: MaintenanceRecord }> => {
    const response = await bffApi.post<AnyMap>('/admin/maintenance/log', data);
    return { maintenance: adaptMaintenanceRecord(response.data) };
  },
};

// ============================================
// Reports API → BFF (daily/monthly), legacy (export)
// ============================================
export const reportsApi = {
  getDaily: async (date: string): Promise<DailyReport> => {
    const response = await bffApi.get<AnyMap>(`/admin/reports/daily/${date}`);
    return adaptDailyReport(response.data, date);
  },

  getMonthly: async (year: number, month: number): Promise<MonthlyReport> => {
    const response = await bffApi.get<AnyMap>(`/admin/reports/monthly/${year}/${month}`);
    return adaptMonthlyReport(response.data);
  },

  // Export not yet in BFF — stays on legacy
  export: async (data: {
    type: string;
    startDate: string;
    endDate: string;
    format?: 'json' | 'pdf' | 'excel';
  }) => {
    const response = await api.post('/admin/reports/export', data);
    return response.data;
  },
};

// ============================================
// Expense adapter
// ============================================
function adaptExpense(raw: AnyMap): Expense {
  return {
    id:            s(raw.id),
    category:      s(raw.category) as ExpenseCategory,
    description:   s(raw.description),
    amount:        n(raw.amount),
    currency:      s(raw.currency) || 'XAF',
    date:          new Date(s(raw.expenseDate ?? raw.date)),
    paymentMethod: (s(raw.paymentMethod) || 'other') as PaymentMethod,
    vendor:        raw.vendor        ? s(raw.vendor)        : undefined,
    receiptNumber: raw.receiptNumber ? s(raw.receiptNumber) : undefined,
    notes:         raw.notes         ? s(raw.notes)         : undefined,
    isRecurring:   raw.isRecurring === true,
    createdAt:     new Date(s(raw.createdAt)),
    updatedAt:     raw.updatedAt     ? new Date(s(raw.updatedAt)) : undefined,
  };
}

// ============================================
// Expenses API → BFF
// ============================================
export const expensesApi = {
  getAll: async (params?: {
    page?: number;
    limit?: number;
    category?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<{
    expenses: Expense[];
    summary: Record<string, number>;
    grandTotal: number;
    pagination: { page: number; limit: number; total: number; pages: number };
  }> => {
    const response = await bffApi.get<AnyMap[]>('/admin/expenses', {
      params: {
        category:  params?.category,
        startDate: params?.startDate,
        endDate:   params?.endDate,
      },
    });
    const expenses = response.data.map(adaptExpense);
    const summary: Record<string, number> = {};
    let grandTotal = 0;
    for (const exp of expenses) {
      summary[exp.category] = (summary[exp.category] ?? 0) + exp.amount;
      grandTotal += exp.amount;
    }
    const page  = params?.page  ?? 1;
    const limit = params?.limit ?? 100;
    return {
      expenses,
      summary,
      grandTotal,
      pagination: { page, limit, total: expenses.length, pages: 1 },
    };
  },

  create: async (data: {
    category: 'utilities' | 'rent' | 'salaries' | 'maintenance' | 'supplies' | 'marketing' | 'insurance' | 'taxes' | 'other';
    description: string;
    amount: number;
    date: string;
    paymentMethod?: 'cash' | 'bank_transfer' | 'mobile_money' | 'cheque' | 'other';
    vendor?: string;
    receiptNumber?: string;
    notes?: string;
  }): Promise<{ expense: Expense }> => {
    const { date, ...rest } = data;
    const response = await bffApi.post<AnyMap>('/admin/expenses', {
      ...rest,
      expenseDate: date,
    });
    return { expense: adaptExpense(response.data) };
  },
};

// ============================================
// Feedback API → BFF
// ============================================
export const feedbackApi = {
  getAll: async (params?: {
    page?: number;
    limit?: number;
    rating?: number;
    machineId?: string;
    startDate?: string;
    endDate?: string;
    hasComment?: boolean;
  }): Promise<FeedbackResponse> => {
    const { limit, ...rest } = params ?? {};
    const response = await bffApi.get<AnyMap>('/admin/feedback', {
      params: { ...rest, size: limit ?? 20 },
    });
    return adaptFeedbackList(response.data);
  },

  getAnalytics: async (period: 'today' | 'week' | 'month' | 'year' = 'month'): Promise<FeedbackAnalytics> => {
    const { startDate, endDate } = periodToDateRange(period);
    const response = await bffApi.get<AnyMap>('/admin/feedback/analytics', {
      params: { startDate, endDate },
    });
    return adaptFeedbackAnalytics(response.data, period);
  },
};

// ============================================
// Reconciliation API → BFF
// ============================================
export const reconciliationApi = {
  run: async (params?: { startDate?: string; endDate?: string }): Promise<ReconciliationResult> => {
    const response = await bffApi.post<AnyMap>('/admin/reconciliation/run', params ?? {});
    return adaptReconciliation(response.data);
  },

  getDiscrepancies: async (): Promise<{
    discrepancies: Discrepancy[];
    count: number;
    lastChecked: Date;
  }> => {
    const response = await bffApi.get<AnyMap[]>('/admin/reconciliation/discrepancies');
    const list = response.data;
    const discrepancies: Discrepancy[] = list.map((d) => ({
      type:              'no_cycle_started' as const,
      transactionId:     s(d.id),
      externalReference: s(d.externalReference),
      amount:            n(d.amount),
      createdAt:         d.createdAt ? new Date(d.createdAt as string) : undefined,
      description:       `Payment with no cycle started: ${d.externalReference}`,
    }));
    return { discrepancies, count: discrepancies.length, lastChecked: new Date() };
  },
};

// ============================================
// Adapter helpers for ops entities (BFF returns id; legacy components expect _id)
// ============================================
function adaptStaffMember(raw: AnyMap): { _id: string; name: string; email: string; role: string } {
  return { _id: s(raw.id), name: s(raw.name), email: s(raw.email), role: s(raw.role) };
}

function adaptTimeEntry(raw: AnyMap): TimeEntry {
  return {
    _id:       s(raw.id),
    employee:  adaptStaffMember((raw.employee ?? {}) as AnyMap),
    type:      s(raw.type) as 'clock_in' | 'clock_out',
    timestamp: s(raw.timestamp),
    method:    (s(raw.method) || 'manual') as 'manual' | 'automatic' | 'system',
    notes:     raw.notes != null ? s(raw.notes) : undefined,
    createdAt: s(raw.createdAt),
    updatedAt: s(raw.updatedAt || raw.createdAt),
  };
}

function adaptAbsence(raw: AnyMap): Absence {
  return {
    _id:         s(raw.id),
    employee:    adaptStaffMember((raw.employee ?? {}) as AnyMap),
    type:        s(raw.type) as AbsenceType,
    startDate:   s(raw.startDate),
    endDate:     s(raw.endDate),
    reason:      raw.reason != null ? s(raw.reason) : undefined,
    status:      s(raw.status) as AbsenceStatus,
    reviewedBy:  raw.reviewedBy != null ? adaptStaffMember(raw.reviewedBy as AnyMap) : undefined,
    reviewedAt:  raw.reviewedAt != null ? s(raw.reviewedAt) : undefined,
    reviewNotes: raw.reviewNotes != null ? s(raw.reviewNotes) : undefined,
    durationDays: n(raw.durationDays),
    createdAt:   s(raw.createdAt),
    updatedAt:   s(raw.updatedAt || raw.createdAt),
  };
}

function adaptUser(raw: AnyMap): User {
  return {
    id:        s(raw.id),
    email:     s(raw.email),
    name:      s(raw.name),
    role:      s(raw.role) as UserRole,
    isActive:  raw.isActive === true,
    createdAt: new Date(s(raw.createdAt)),
    lastLogin: raw.lastLogin != null ? new Date(s(raw.lastLogin)) : undefined,
  };
}

// ============================================
// Users API → BFF /api/admin/users
// ============================================
export const usersApi = {
  getAll: async (params?: {
    page?: number;
    limit?: number;
    role?: UserRole;
    isActive?: boolean;
    search?: string;
  }): Promise<{
    users: User[];
    pagination: { page: number; limit: number; total: number; pages: number };
  }> => {
    const response = await bffApi.get<AnyMap>('/admin/users', { params });
    const raw = response.data;
    const users = ((raw.users ?? []) as AnyMap[]).map(adaptUser);
    return { users, pagination: raw.pagination as { page: number; limit: number; total: number; pages: number } };
  },

  getById: async (id: string): Promise<User> => {
    const response = await bffApi.get<AnyMap>(`/admin/users/${id}`);
    return adaptUser(response.data);
  },

  create: async (data: UserCreateInput): Promise<User> => {
    const response = await bffApi.post<AnyMap>('/admin/users', data);
    return adaptUser(response.data);
  },

  update: async (id: string, data: UserUpdateInput): Promise<User> => {
    const response = await bffApi.put<AnyMap>(`/admin/users/${id}`, data);
    return adaptUser(response.data);
  },

  delete: async (id: string): Promise<{ deleted: boolean; userId: string }> => {
    const response = await bffApi.delete<AnyMap>(`/admin/users/${id}`);
    return response.data as { deleted: boolean; userId: string };
  },

  deactivate: async (id: string): Promise<User> => {
    const response = await bffApi.post<AnyMap>(`/admin/users/${id}/deactivate`);
    return adaptUser(response.data);
  },

  activate: async (id: string): Promise<User> => {
    const response = await bffApi.post<AnyMap>(`/admin/users/${id}/activate`);
    return adaptUser(response.data);
  },

  getSessions: async (id: string): Promise<{ sessions: SessionInfo[]; count: number }> => {
    const response = await bffApi.get<AnyMap>(`/admin/users/${id}/sessions`);
    return response.data as { sessions: SessionInfo[]; count: number };
  },

  revokeSession: async (userId: string, sessionIndex: number): Promise<{ message: string }> => {
    const response = await bffApi.delete<AnyMap>(`/admin/users/${userId}/sessions/${sessionIndex}`);
    return response.data as { message: string };
  },

  getLoginHistory: async (id: string, limit?: number): Promise<{ history: LoginHistoryEntry[] }> => {
    const response = await bffApi.get<AnyMap>(`/admin/users/${id}/login-history`, { params: { limit } });
    return response.data as { history: LoginHistoryEntry[] };
  },

  resetPassword: async (id: string, newPassword: string): Promise<{ message: string }> => {
    const response = await bffApi.post<AnyMap>(`/admin/users/${id}/reset-password`, { newPassword });
    return response.data as { message: string };
  },
};

// ============================================
// Timekeeping API → BFF /api/admin/timekeeping
// ============================================
export interface TimeEntry {
  _id: string;
  employee: { _id: string; name: string; email: string; role: string };
  type: 'clock_in' | 'clock_out';
  timestamp: string;
  method: 'manual' | 'automatic' | 'system';
  ipAddress?: string;
  userAgent?: string;
  notes?: string;
  createdBy?: { _id: string; name: string; email: string };
  createdAt: string;
  updatedAt: string;
}

export interface ClockStatus {
  isClockedIn: boolean;
  lastEntry: TimeEntry | null;
  currentSessionDuration: {
    hours: number;
    minutes: number;
    formatted: string;
    startTime: string;
  } | null;
}

export interface TimeEntrySummary {
  employee: { _id: string; name: string; email: string; role: string };
  period: { start: string; end: string };
  totalHours: number;
  totalMinutes: number;
  remainingMinutes: number;
  formattedDuration: string;
  sessions: Array<{
    date: string;
    clockIn: string;
    clockOut: string | null;
    duration: string;
    isOpen: boolean;
  }>;
}

export const timekeepingApi = {
  clockIn: async (notes?: string): Promise<{ success: boolean; message: string; entry: TimeEntry }> => {
    const response = await bffApi.post<AnyMap>('/admin/timekeeping/clock-in', { notes });
    const raw = response.data;
    return { success: true, message: s(raw.message), entry: adaptTimeEntry((raw.entry ?? {}) as AnyMap) };
  },

  clockOut: async (notes?: string): Promise<{
    success: boolean;
    message: string;
    entry: TimeEntry;
    sessionDuration: { hours: number; minutes: number; formatted: string };
  }> => {
    const response = await bffApi.post<AnyMap>('/admin/timekeeping/clock-out', { notes });
    const raw = response.data;
    const sd  = (raw.sessionDuration ?? {}) as AnyMap;
    return {
      success: true,
      message: s(raw.message),
      entry:   adaptTimeEntry((raw.entry ?? {}) as AnyMap),
      sessionDuration: { hours: n(sd.hours), minutes: n(sd.minutes), formatted: s(sd.formatted) },
    };
  },

  getStatus: async (): Promise<{ success: boolean; status: ClockStatus }> => {
    const response = await bffApi.get<AnyMap>('/admin/timekeeping/status');
    const raw = response.data;
    const sd  = (raw.currentSessionDuration ?? null) as AnyMap | null;
    return {
      success: true,
      status: {
        isClockedIn: raw.isClockedIn === true,
        lastEntry:   raw.lastEntry != null ? adaptTimeEntry(raw.lastEntry as AnyMap) : null,
        currentSessionDuration: sd ? {
          hours:     n(sd.hours),
          minutes:   n(sd.minutes),
          formatted: s(sd.formatted),
          startTime: s(sd.startTime),
        } : null,
      },
    };
  },

  getEntries: async (params?: {
    startDate?: string;
    endDate?: string;
    employeeId?: string;
    page?: number;
    limit?: number;
  }): Promise<{
    success: boolean;
    entries: TimeEntry[];
    pagination: { page: number; limit: number; total: number; pages: number };
  }> => {
    const response = await bffApi.get<AnyMap>('/admin/timekeeping/entries', { params });
    const raw = response.data;
    return {
      success: true,
      entries: ((raw.entries ?? []) as AnyMap[]).map(adaptTimeEntry),
      pagination: raw.pagination as { page: number; limit: number; total: number; pages: number },
    };
  },

  createManualEntry: async (data: {
    employeeId: string;
    type: 'clock_in' | 'clock_out';
    timestamp: string;
    notes?: string;
  }): Promise<{ success: boolean; message: string; entry: TimeEntry }> => {
    const response = await bffApi.post<AnyMap>('/admin/timekeeping/entries', data);
    return { success: true, message: 'Entry created', entry: adaptTimeEntry(response.data) };
  },

  getSummary: async (params?: {
    startDate?: string;
    endDate?: string;
    employeeId?: string;
  }): Promise<{ success: boolean; summary: TimeEntrySummary }> => {
    const response = await bffApi.get<AnyMap>('/admin/timekeeping/summary', { params });
    const raw = response.data;
    return {
      success: true,
      summary: {
        employee:        adaptStaffMember((raw.employee ?? {}) as AnyMap),
        period:          raw.period as { start: string; end: string },
        totalHours:      n(raw.totalHours),
        totalMinutes:    n(raw.totalMinutes),
        remainingMinutes:n(raw.remainingMinutes),
        formattedDuration: s(raw.formattedDuration),
        sessions: ((raw.sessions ?? []) as AnyMap[]).map(sess => ({
          date:     s(sess.date),
          clockIn:  s(sess.clockIn),
          clockOut: sess.clockOut != null ? s(sess.clockOut) : null,
          duration: s(sess.duration),
          isOpen:   sess.isOpen === true,
        })),
      },
    };
  },

  getToday: async (): Promise<{
    success: boolean;
    today: {
      entries: TimeEntry[];
      sessions: Array<{
        clockIn: TimeEntry;
        clockOut: TimeEntry | null;
        durationMs: number;
        durationFormatted: string;
        isOpen?: boolean;
      }>;
      totalHours: string;
    };
  }> => {
    const response = await bffApi.get<AnyMap>('/admin/timekeeping/today');
    const raw   = response.data;
    const today = (raw.today ?? {}) as AnyMap;
    return {
      success: true,
      today: {
        entries:    ((today.entries   ?? []) as AnyMap[]).map(adaptTimeEntry),
        sessions:   ((today.sessions  ?? []) as AnyMap[]).map(s_ => ({
          clockIn:          adaptTimeEntry((s_.clockIn  ?? s_) as AnyMap),
          clockOut:         s_.clockOut != null ? adaptTimeEntry(s_.clockOut as AnyMap) : null,
          durationMs:       0,
          durationFormatted:s(s_.duration),
          isOpen:           s_.isOpen === true,
        })),
        totalHours: s(today.totalHours),
      },
    };
  },

  deleteEntry: async (id: string): Promise<{ success: boolean; message: string }> => {
    await bffApi.delete(`/admin/timekeeping/entries/${id}`);
    return { success: true, message: 'Entry deleted' };
  },
};

// ============================================
// Absences API → BFF /api/admin/absences
// ============================================
export type AbsenceType =
  | 'vacation'
  | 'sick'
  | 'personal'
  | 'unpaid_leave'
  | 'family_emergency'
  | 'training';
export type AbsenceStatus = 'pending' | 'approved' | 'rejected';

export interface Absence {
  _id: string;
  employee: { _id: string; name: string; email: string; role: string };
  type: AbsenceType;
  startDate: string;
  endDate: string;
  reason?: string;
  status: AbsenceStatus;
  reviewedBy?: { _id: string; name: string; email: string };
  reviewedAt?: string;
  reviewNotes?: string;
  createdBy?: { _id: string; name: string; email: string };
  durationDays: number;
  createdAt: string;
  updatedAt: string;
}

export interface AbsenceSummary {
  vacation:         { totalDays: number; count: number };
  sick:             { totalDays: number; count: number };
  personal:         { totalDays: number; count: number };
  unpaid_leave:     { totalDays: number; count: number };
  family_emergency: { totalDays: number; count: number };
  training:         { totalDays: number; count: number };
}

// Default export — legacy axios instance (used by src/lib/auth/api.ts)
export { api as default };

export const absencesApi = {
  getAll: async (params?: {
    startDate?: string;
    endDate?: string;
    employeeId?: string;
    status?: AbsenceStatus;
    type?: AbsenceType;
    page?: number;
    limit?: number;
  }): Promise<{
    success: boolean;
    absences: Absence[];
    pagination: { page: number; limit: number; total: number; pages: number };
  }> => {
    const response = await bffApi.get<AnyMap>('/admin/absences', { params });
    const raw = response.data;
    return {
      success: true,
      absences: ((raw.absences ?? []) as AnyMap[]).map(adaptAbsence),
      pagination: raw.pagination as { page: number; limit: number; total: number; pages: number },
    };
  },

  getById: async (id: string): Promise<{ success: boolean; absence: Absence }> => {
    const response = await bffApi.get<AnyMap>(`/admin/absences/${id}`);
    return { success: true, absence: adaptAbsence(response.data) };
  },

  create: async (data: {
    employeeId?: string;
    type: AbsenceType;
    startDate: string;
    endDate: string;
    reason?: string;
  }): Promise<{ success: boolean; message: string; absence: Absence }> => {
    const response = await bffApi.post<AnyMap>('/admin/absences', data);
    return { success: true, message: 'Absence created', absence: adaptAbsence(response.data) };
  },

  update: async (
    id: string,
    data: { type?: AbsenceType; startDate?: string; endDate?: string; reason?: string },
  ): Promise<{ success: boolean; message: string; absence: Absence }> => {
    const response = await bffApi.put<AnyMap>(`/admin/absences/${id}`, data);
    return { success: true, message: 'Absence updated', absence: adaptAbsence(response.data) };
  },

  delete: async (id: string): Promise<{ success: boolean; message: string }> => {
    await bffApi.delete(`/admin/absences/${id}`);
    return { success: true, message: 'Absence deleted' };
  },

  approve: async (
    id: string,
    notes?: string,
  ): Promise<{ success: boolean; message: string; absence: Absence }> => {
    const response = await bffApi.post<AnyMap>(`/admin/absences/${id}/approve`, { notes });
    return { success: true, message: 'Absence approved', absence: adaptAbsence(response.data) };
  },

  reject: async (
    id: string,
    notes: string,
  ): Promise<{ success: boolean; message: string; absence: Absence }> => {
    const response = await bffApi.post<AnyMap>(`/admin/absences/${id}/reject`, { notes });
    return { success: true, message: 'Absence rejected', absence: adaptAbsence(response.data) };
  },

  getPendingCount: async (): Promise<{
    success: boolean;
    count: number;
    byEmployee: Array<{ employee: { name: string; email: string }; count: number }>;
  }> => {
    const response = await bffApi.get<AnyMap>('/admin/absences/pending');
    const raw = response.data;
    return {
      success: true,
      count:      n(raw.count),
      byEmployee: ((raw.byEmployee ?? []) as AnyMap[]).map(r => ({
        employee: r.employee as { name: string; email: string },
        count:    n(r.count),
      })),
    };
  },

  getEmployeeSummary: async (
    employeeId: string,
    year?: number,
  ): Promise<{
    success: boolean;
    employee: { _id: string; name: string; email: string; role: string };
    year: number;
    summary: AbsenceSummary;
  }> => {
    const response = await bffApi.get<AnyMap>(`/admin/absences/summary/${employeeId}`, { params: { year } });
    const raw = response.data;
    // CamelCaseAdvice converts unpaid_leave→unpaidLeave and family_emergency→familyEmergency;
    // AbsenceSummary interface uses the original underscore keys — remap here.
    const rs  = (raw.summary ?? {}) as AnyMap;
    const empty = { totalDays: 0, count: 0 };
    return {
      success:  true,
      employee: adaptStaffMember((raw.employee ?? {}) as AnyMap),
      year:     n(raw.year),
      summary: {
        vacation:         (rs.vacation         ?? empty) as AbsenceSummary['vacation'],
        sick:             (rs.sick             ?? empty) as AbsenceSummary['sick'],
        personal:         (rs.personal         ?? empty) as AbsenceSummary['personal'],
        unpaid_leave:     (rs.unpaidLeave      ?? empty) as AbsenceSummary['unpaid_leave'],
        family_emergency: (rs.familyEmergency  ?? empty) as AbsenceSummary['family_emergency'],
        training:         (rs.training         ?? empty) as AbsenceSummary['training'],
      },
    };
  },

  getTypes: async (): Promise<{
    success: boolean;
    types: Array<{ value: AbsenceType; label: string }>;
  }> => {
    const response = await bffApi.get<AnyMap>('/admin/absences/types');
    const raw = response.data;
    return { success: true, types: (raw.types ?? []) as Array<{ value: AbsenceType; label: string }> };
  },
};

// ============================================
// Settings API → BFF /api/admin/settings + PMS /api/pricing
// ============================================
export interface ProgramPricingItem {
  name:  string;
  price: number;
}

/** Cycle/reservation prices from PaymentManagementService — the amounts actually charged. */
export interface CyclePricingItem {
  key:      string;
  label:    string;
  amount:   number;
  currency: string;
}

export interface MachineConfig {
  pricing:       ProgramPricingItem[];
  warningCycles:  number;
  criticalCycles: number;
  /** Live cycle prices from PMS — authoritative for bot & RFID payments. */
  cyclePricing?: CyclePricingItem[];
}

export const settingsApi = {
  getMachineConfig: async (): Promise<MachineConfig> => {
    const [bffResp, pmsResp] = await Promise.allSettled([
      bffApi.get<AnyMap>('/admin/settings/machines'),
      paymentsApi.get<AnyMap[]>('/api/pricing'),
    ]);

    const raw = bffResp.status === 'fulfilled' ? bffResp.value.data : {};
    const cyclePricing: CyclePricingItem[] = pmsResp.status === 'fulfilled'
      ? (pmsResp.value.data ?? []).map((p: AnyMap) => ({
          key:      s(p.key),
          label:    s(p.label),
          amount:   n(p.amount),
          currency: s(p.currency ?? 'XAF'),
        }))
      : [];

    return {
      pricing:        ((raw.pricing ?? []) as AnyMap[]).map(p => ({ name: s(p.name), price: n(p.price) })),
      warningCycles:  n(raw.warningCycles  ?? 300),
      criticalCycles: n(raw.criticalCycles ?? 400),
      cyclePricing,
    };
  },

  saveMachineConfig: async (config: MachineConfig): Promise<MachineConfig> => {
    const saves: Promise<unknown>[] = [
      bffApi.put<AnyMap>('/admin/settings/machines', {
        pricing:       config.pricing,
        warningCycles: config.warningCycles,
        criticalCycles: config.criticalCycles,
      }),
    ];

    if (config.cyclePricing && config.cyclePricing.length > 0) {
      for (const item of config.cyclePricing) {
        saves.push(paymentsApi.put(`/api/pricing/${item.key}`, { amount: item.amount }));
      }
    }

    await Promise.all(saves);
    return settingsApi.getMachineConfig();
  },
};
