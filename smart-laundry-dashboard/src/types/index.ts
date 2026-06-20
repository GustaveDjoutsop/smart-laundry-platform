// ============================================
// Machine Types
// ============================================
export type MachineType = 'washer' | 'dryer';
export type MachineStatusType = 'available' | 'in_use' | 'reserved' | 'completing' | 'error' | 'maintenance' | 'offline';

export interface MachineStatus {
  id: string;
  type: MachineType;
  name: string;
  status: MachineStatusType;

  // Current cycle info (when in_use)
  currentProgram?: string;
  timeRemaining?: number;
  remainingMinutes?: number;

  // Today's stats from backend
  todayRevenue?: number;
  todayCycles?: number;

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
  utilizationRate: number;
  averageCyclesPerDay: number;
}

// ============================================
// Transaction Types (matches backend Transaction model)
// ============================================
export type TransactionStatus = 'PENDING' | 'SUCCESSFUL' | 'FAILED';
export type CycleStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
export type PaymentProvider = 'campay' | 'mtn';

export interface Transaction {
  id: string;
  externalReference: string;
  amount: number;
  phoneNumber: string;
  machineId: string;
  machineName?: string;
  pulseCount: number;
  cycleDuration: number;
  description?: string;
  status: TransactionStatus;
  cycleStatus: CycleStatus;
  cycleStartedAt?: Date;
  cycleEndsAt?: Date;
  campayReference?: string;
  mtnReferenceId?: string;
  mtnTransactionId?: string;
  paymentProvider: PaymentProvider;
  failureReason?: string;
  cycleCompletedNotified?: boolean;
  feedbackRequestedAt?: Date;
  feedbackRequestSent?: boolean;
  feedback?: {
    rating?: number;
    comment?: string;
    submittedAt?: Date;
    staffAlertSent?: boolean;
  };
  createdAt: Date;
  updatedAt?: Date;
}

// ============================================
// Maintenance Types (matches backend Maintenance model)
// ============================================
export type MaintenanceType = 'preventive' | 'corrective' | 'emergency' | 'inspection';
export type MaintenanceStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
export type MaintenancePriority = 'low' | 'medium' | 'high' | 'critical';

export interface MaintenanceRecord {
  id: string;
  machineId: string;
  type: MaintenanceType;
  status: MaintenanceStatus;
  priority: MaintenancePriority;
  description: string;
  notes?: string;
  scheduledDate?: Date;
  completedDate?: Date;
  performedBy?: string;
  cost: number;
  partsReplaced?: Array<{
    name: string;
    quantity: number;
    cost: number;
  }>;
  isAlert?: boolean;
  alertAcknowledged?: boolean;
  alertAcknowledgedAt?: Date;
  alertAcknowledgedBy?: string;
  createdAt: Date;
  updatedAt?: Date;
}

export interface MaintenanceAlert {
  id: string;
  machineId: string;
  type: MaintenanceType;
  status: MaintenanceStatus;
  priority: MaintenancePriority;
  description: string;
  isAlert: boolean;
  alertAcknowledged: boolean;
  createdAt: Date;
}

// ============================================
// Expense Types (matches backend Expense model)
// ============================================
export type ExpenseCategory = 'utilities' | 'rent' | 'salaries' | 'maintenance' | 'supplies' | 'marketing' | 'insurance' | 'taxes' | 'other';
export type PaymentMethod = 'cash' | 'bank_transfer' | 'mobile_money' | 'cheque' | 'other';

export interface Expense {
  id: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  currency: string;
  date: Date;
  paymentMethod: PaymentMethod;
  vendor?: string;
  receiptNumber?: string;
  notes?: string;
  maintenanceId?: string;
  isRecurring?: boolean;
  recurringFrequency?: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  createdBy?: string;
  createdAt: Date;
  updatedAt?: Date;
}

// ============================================
// Dashboard Types (matches backend admin controller responses)
// ============================================
export interface DashboardSummary {
  revenue: {
    today: number;
    todayTransactions: number;
    month: number;
    monthTransactions: number;
  };
  machines: {
    total: number;
    inUse: number;
    available: number;
  };
  alerts: {
    maintenance: number;
    stalePending: number;
    total: number;
  };
  feedback: {
    averageRating: string | null;
    totalReviews: number;
  };
}

export interface DashboardStats {
  period: string;
  dateRange: { start: Date; end: Date };
  revenueByDay: Array<{
    _id: string;
    revenue: number;
    transactions: number;
  }>;
  transactionsByStatus: Record<TransactionStatus, number>;
  usageByHour: Array<{ hour: number; count: number }>;
}

// ============================================
// Revenue Types (matches backend admin controller responses)
// ============================================
export interface RevenueSummary {
  period: string;
  dateRange: { start: Date; end: Date };
  current: {
    total: number;
    transactions: number;
    avgTransaction: number;
  };
  previous: {
    total: number;
    transactions: number;
  };
  growth: {
    amount: number;
    percent: string | null;
  };
}

export interface RevenueByProvider {
  period: string;
  dateRange: { start: Date; end: Date };
  providers: Array<{
    provider: string;
    revenue: number;
    transactions: number;
    percentage: string;
  }>;
  total: number;
}

export interface RevenueByProgram {
  period: string;
  dateRange: { start: Date; end: Date };
  programs: Array<{
    duration: number;
    name: string;
    revenue: number;
    transactions: number;
    percentage: string;
  }>;
  total: number;
}

export interface RevenueByMachine {
  period: string;
  dateRange: { start: Date; end: Date };
  machines: Array<{
    machineId: string;
    name: string;
    type: MachineType;
    revenue: number;
    cycles: number;
    percentage: string;
  }>;
  total: number;
}

export interface RevenueTrends {
  months: number;
  trends: Array<{
    month: string;
    revenue: number;
    transactions: number;
  }>;
}

// ============================================
// Report Types (matches backend admin controller responses)
// ============================================
export interface DailyReport {
  date: string;
  revenue: {
    total: number;
    transactions: number;
  };
  expenses: number;
  profit: number;
  failedTransactions: number;
  byMachine: Array<{
    machineId: string;
    name: string;
    revenue: number;
    cycles: number;
  }>;
  byHour: Array<{
    hour: number;
    revenue: number;
    cycles: number;
  }>;
}

export interface MonthlyReport {
  year: number;
  month: number;
  dateRange: { start: Date; end: Date };
  revenue: {
    total: number;
    transactions: number;
  };
  expenses: {
    total: number;
    byCategory: Array<{
      category: ExpenseCategory;
      amount: number;
    }>;
  };
  profit: number;
  profitMargin: string;
  dailyRevenue: Array<{
    day: number;
    revenue: number;
    transactions: number;
  }>;
}

// ============================================
// Feedback Types (matches backend admin controller responses)
// ============================================
export interface FeedbackItem {
  id: string;
  transactionId: string;
  machineId: string;
  machineName: string;
  machineType: MachineType;
  customerPhone: string | null;
  rating: number;
  comment: string | null;
  submittedAt: Date;
  transactionDate: Date;
  amount: number;
  cycleDuration: number;
  staffAlertSent: boolean;
}

export interface FeedbackStats {
  averageRating: string | null;
  totalReviews: number;
  withComments: number;
}

export interface RatingDistribution {
  rating: number;
  count: number;
}

export interface FeedbackResponse {
  feedback: FeedbackItem[];
  stats: FeedbackStats;
  distribution: RatingDistribution[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export interface FeedbackAnalytics {
  period: string;
  dateRange: { start: Date; end: Date };
  trend: Array<{
    date: string;
    averageRating: number;
    count: number;
  }>;
  byMachine: Array<{
    machineId: string;
    name: string;
    type: MachineType;
    averageRating: number;
    totalReviews: number;
  }>;
  lowRatingAlerts: Array<{
    id: string;
    machineId: string;
    machineName: string;
    rating: number;
    comment: string | null;
    submittedAt: Date;
    customerPhone: string | null;
  }>;
}

// ============================================
// Reconciliation Types
// ============================================
export interface Discrepancy {
  type: 'stale_pending' | 'no_cycle_started';
  transactionId?: string;
  externalReference?: string;
  amount?: number;
  createdAt?: Date;
  description: string;
  transaction?: Transaction;
}

export interface ReconciliationResult {
  dateRange: { start: Date; end: Date };
  summary: {
    totalTransactions: number;
    successful: number;
    failed: number;
    pending: number;
    totalRevenue: number;
    failedAmount: number;
  };
  discrepancies: Discrepancy[];
  discrepancyCount: number;
  reconciliationStatus: 'OK' | 'NEEDS_ATTENTION';
}

// ============================================
// User & Access Control Types
// ============================================
export enum UserRole {
  ADMIN = 'admin',
  OWNER = 'owner',
  MANAGER = 'manager',
  ACCOUNTANT = 'accountant',
  EMPLOYEE = 'employee',
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  lastLogin?: Date;
  createdBy?: {
    id: string;
    name: string;
    email: string;
  };
}

export interface UserCreateInput {
  email: string;
  password: string;
  name: string;
  role: UserRole;
}

export interface UserUpdateInput {
  email?: string;
  name?: string;
  role?: UserRole;
  isActive?: boolean;
}

export interface SessionInfo {
  deviceInfo: string;
  createdAt: Date;
  lastUsed: Date;
  ipAddress?: string;
}

export interface LoginHistoryEntry {
  timestamp: Date;
  ipAddress: string;
  userAgent: string;
  success: boolean;
}

// ============================================
// Cafe Types (for future use)
// ============================================
export interface CafeSale {
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

// ============================================
// API Response Types
// ============================================
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

// ============================================
// Legacy types for backward compatibility
// ============================================
export type AlertSeverity = MaintenancePriority;
export type AlertType = 'cycles' | 'time' | 'error_frequency';
export type ReportPeriodType = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual';

export interface FinancialReport {
  period: {
    start: Date;
    end: Date;
    type: ReportPeriodType;
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
    supplies: number;
    rent: number;
    staff: number;
    paymentFees: number;
    other: number;
  };
  fees: {
    [provider: string]: {
      transactions: number;
      totalFees: number;
      feeRate: number;
    };
  };
  summary: {
    grossRevenue: number;
    totalExpenses: number;
    paymentFees: number;
    netRevenue: number;
    profitMargin: number;
  };
  tax: {
    vatCollected?: number;
    vatRate?: number;
    taxableIncome: number;
  };
}
