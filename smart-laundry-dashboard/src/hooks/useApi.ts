'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  dashboardApi,
  machinesApi,
  transactionsApi,
  revenueApi,
  maintenanceApi,
  reportsApi,
  expensesApi,
  reconciliationApi,
  healthApi,
} from '@/lib/api';
import type {
  DashboardSummary,
  DashboardStats,
  MachineStatus,
  Transaction,
  RevenueSummary,
  RevenueByProvider,
  RevenueByProgram,
  RevenueByMachine,
  RevenueTrends,
  MaintenanceAlert,
  MaintenanceRecord,
  DailyReport,
  MonthlyReport,
  Expense,
  ReconciliationResult,
  Discrepancy,
} from '@/types';

// ============================================
// Generic hook for API calls
// ============================================
interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

function useApiCall<T>(
  apiCall: () => Promise<T>,
  dependencies: unknown[] = []
): UseApiState<T> & { refetch: () => Promise<void> } {
  const [state, setState] = useState<UseApiState<T>>({
    data: null,
    loading: true,
    error: null,
  });

  const fetchData = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const data = await apiCall();
      setState({ data, loading: false, error: null });
    } catch (error) {
      setState({ data: null, loading: false, error: error as Error });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { ...state, refetch: fetchData };
}

// ============================================
// Health Check Hook
// ============================================
export function useHealthCheck() {
  return useApiCall(() => healthApi.check(), []);
}

// ============================================
// Dashboard Hooks
// ============================================
export function useDashboardSummary() {
  return useApiCall<DashboardSummary>(() => dashboardApi.getSummary(), []);
}

export function useDashboardStats(period: 'today' | 'week' | 'month' | 'year' = 'week') {
  return useApiCall<DashboardStats>(() => dashboardApi.getStats(period), [period]);
}

// ============================================
// Machines Hooks
// ============================================
export function useMachines() {
  return useApiCall<{
    machines: MachineStatus[];
    summary: { total: number; available: number; inUse: number; reserved: number };
  }>(() => machinesApi.getAll(), []);
}

export function useMachine(id: string) {
  return useApiCall(() => machinesApi.getById(id), [id]);
}

export function useMachineHistory(
  id: string,
  params?: { period?: string; page?: number; limit?: number }
) {
  return useApiCall(
    () => id ? machinesApi.getHistory(id, params) : Promise.resolve(null),
    [id, params?.period, params?.page, params?.limit]
  );
}

// ============================================
// Transactions Hooks
// ============================================
export function useTransactions(params?: {
  page?: number;
  limit?: number;
  status?: 'PENDING' | 'SUCCESSFUL' | 'FAILED';
  machineId?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
}) {
  return useApiCall<{
    transactions: Transaction[];
    pagination: { page: number; limit: number; total: number; pages: number };
  }>(
    () => transactionsApi.getAll(params),
    [params?.page, params?.limit, params?.status, params?.machineId, params?.startDate, params?.endDate, params?.search]
  );
}

export function useTransaction(id: string) {
  return useApiCall<Transaction>(() => transactionsApi.getById(id), [id]);
}

// ============================================
// Revenue Hooks
// ============================================
export function useRevenueSummary(period: 'today' | 'week' | 'month' | 'year' = 'month') {
  return useApiCall<RevenueSummary>(() => revenueApi.getSummary(period), [period]);
}

export function useRevenueByProvider(period: 'today' | 'week' | 'month' | 'year' = 'month') {
  return useApiCall<RevenueByProvider>(() => revenueApi.getByProvider(period), [period]);
}

export function useRevenueByProgram(period: 'today' | 'week' | 'month' | 'year' = 'month') {
  return useApiCall<RevenueByProgram>(() => revenueApi.getByProgram(period), [period]);
}

export function useRevenueByMachine(period: 'today' | 'week' | 'month' | 'year' = 'month') {
  return useApiCall<RevenueByMachine>(() => revenueApi.getByMachine(period), [period]);
}

export function useRevenueTrends(months: number = 6) {
  return useApiCall<RevenueTrends>(() => revenueApi.getTrends(months), [months]);
}

// ============================================
// Maintenance Hooks
// ============================================
export function useMaintenanceAlerts() {
  return useApiCall<{ alerts: MaintenanceAlert[] }>(() => maintenanceApi.getAlerts(), []);
}

export function useMaintenanceHistory(params?: {
  page?: number;
  limit?: number;
  machineId?: string;
  status?: string;
}) {
  return useApiCall<{
    maintenance: MaintenanceRecord[];
    pagination: { page: number; limit: number; total: number; pages: number };
  }>(
    () => maintenanceApi.getHistory(params),
    [params?.page, params?.limit, params?.machineId, params?.status]
  );
}

// ============================================
// Reports Hooks
// ============================================
export function useDailyReport(date: string) {
  return useApiCall<DailyReport>(() => reportsApi.getDaily(date), [date]);
}

export function useMonthlyReport(year: number, month: number) {
  return useApiCall<MonthlyReport>(() => reportsApi.getMonthly(year, month), [year, month]);
}

// ============================================
// Expenses Hooks
// ============================================
export function useExpenses(params?: {
  page?: number;
  limit?: number;
  category?: string;
  startDate?: string;
  endDate?: string;
}) {
  return useApiCall<{
    expenses: Expense[];
    summary: Record<string, number>;
    grandTotal: number;
    pagination: { page: number; limit: number; total: number; pages: number };
  }>(
    () => expensesApi.getAll(params),
    [params?.page, params?.limit, params?.category, params?.startDate, params?.endDate]
  );
}

// ============================================
// Reconciliation Hooks
// ============================================
export function useReconciliation(params?: { startDate?: string; endDate?: string }) {
  const [result, setResult] = useState<ReconciliationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const runReconciliation = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await reconciliationApi.run(params);
      setResult(data);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [params]);

  return { result, loading, error, runReconciliation };
}

export function useDiscrepancies() {
  return useApiCall<{
    discrepancies: Discrepancy[];
    count: number;
    lastChecked: Date;
  }>(() => reconciliationApi.getDiscrepancies(), []);
}

// ============================================
// Polling Hook for Real-time Updates
// ============================================
export function usePolling<T>(
  apiCall: () => Promise<T>,
  intervalMs: number = 30000,
  enabled: boolean = true
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Use ref to store the apiCall to avoid infinite loops
  const apiCallRef = useRef(apiCall);
  apiCallRef.current = apiCall;

  const fetchData = useCallback(async () => {
    try {
      const result = await apiCallRef.current();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    fetchData();

    const interval = setInterval(fetchData, intervalMs);
    return () => clearInterval(interval);
  }, [fetchData, intervalMs, enabled]);

  return { data, loading, error, refetch: fetchData };
}

// ============================================
// Dashboard with Auto-Refresh
// ============================================
export function useDashboardWithPolling(intervalMs: number = 30000) {
  return usePolling(() => dashboardApi.getSummary(), intervalMs);
}

export function useMachinesWithPolling(intervalMs: number = 10000) {
  return usePolling(() => machinesApi.getAll(), intervalMs);
}
