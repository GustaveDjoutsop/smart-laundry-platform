'use client';

import { Banknote, WashingMachine, AlertTriangle, TrendingUp, RefreshCw, WifiOff } from 'lucide-react';
import Header from '@/components/ui/Header';
import StatCard from '@/components/ui/StatCard';
import MachineStatusGrid from '@/components/dashboard/MachineStatusGrid';
import RecentTransactions from '@/components/dashboard/RecentTransactions';
import RevenueChart from '@/components/dashboard/RevenueChart';
import { formatCurrency } from '@/lib/utils';
import { useDashboardSummary, useMachines, useTransactions, useDashboardStats } from '@/hooks';
import { useAuth, hasPermission } from '@/lib/auth';
import type { MachineStatus } from '@/types';
import type { DisplayTransaction } from '@/components/dashboard/RecentTransactions/types';

// Fallback mock data when backend is not available
const fallbackMachines: MachineStatus[] = [
  { id: 'w1', type: 'washer', name: 'Washer 1', status: 'available', totalCycles: 1520, cyclesThisMonth: 89, cyclesToday: 5, cyclesSinceMaintenance: 120, errorCount: 0, utilizationRate: 65, averageCyclesPerDay: 8 },
  { id: 'w2', type: 'washer', name: 'Washer 2', status: 'in_use', currentProgram: 'Standard', timeRemaining: 25, totalCycles: 1480, cyclesThisMonth: 92, cyclesToday: 6, cyclesSinceMaintenance: 95, errorCount: 0, utilizationRate: 70, averageCyclesPerDay: 9 },
  { id: 'd1', type: 'dryer', name: 'Dryer 1', status: 'available', totalCycles: 1200, cyclesThisMonth: 72, cyclesToday: 4, cyclesSinceMaintenance: 100, errorCount: 0, utilizationRate: 58, averageCyclesPerDay: 7 },
];

const fallbackTransactions: DisplayTransaction[] = [];

const fallbackWeeklyRevenue = [
  { day: 'Mon', revenue: 0 },
  { day: 'Tue', revenue: 0 },
  { day: 'Wed', revenue: 0 },
  { day: 'Thu', revenue: 0 },
  { day: 'Fri', revenue: 0 },
  { day: 'Sat', revenue: 0 },
  { day: 'Sun', revenue: 0 },
];

export default function DashboardPage() {
  const { user } = useAuth();

  // Check if user has permission to view financial data
  const canViewFinance = user ? hasPermission(user, 'finance:dashboard') : false;

  // Fetch data from backend
  const { data: summaryData, refetch: refetchSummary } = useDashboardSummary();
  const { data: machinesData, loading: machinesLoading, error: machinesError, refetch: refetchMachines } = useMachines();
  const { data: transactionsData } = useTransactions({ limit: 5 });
  const { data: statsData } = useDashboardStats('week');

  // Only show loading skeleton on very first load when we have no data at all
  // This allows the page to render quickly with fallback data while fetching
  const isInitialLoading = machinesLoading && !machinesData?.machines;

  // Only show offline error for machines (which all users should be able to access)
  // Don't show error for financial endpoints if user doesn't have permission
  const hasConnectionError = machinesError !== null;
  const isOffline = hasConnectionError;

  // Use API data or fallback to mock data
  const machines = machinesData?.machines || fallbackMachines;
  const apiTransactions = transactionsData?.transactions || [];

  // Calculate stats from API response or fallback (only use financial data if user has permission)
  const todayRevenue = canViewFinance ? (summaryData?.revenue?.today || 0) : 0;
  const monthRevenue = canViewFinance ? (summaryData?.revenue?.month || 0) : 0;
  const activeMachines = summaryData?.machines?.inUse || machines.filter((m) => m.status === 'in_use').length;
  const totalMachines = summaryData?.machines?.total || machines.length;
  const alertsCount = summaryData?.alerts?.total || machines.filter((m) => m.status === 'error' || m.cyclesSinceMaintenance > 300).length;

  // Transform stats data for revenue chart (only if user has permission)
  const weeklyRevenue = canViewFinance && statsData?.revenueByDay?.map((day) => ({
    day: new Date(day._id).toLocaleDateString('en-US', { weekday: 'short' }),
    revenue: day.revenue,
  })) || fallbackWeeklyRevenue;

  const handleRefresh = () => {
    if (canViewFinance) {
      refetchSummary();
    }
    refetchMachines();
  };

  if (isInitialLoading) {
    return (
      <>
        <Header title="Dashboard" alertsCount={0} />
        <main className="flex-1 overflow-y-auto p-6">
          <div className="animate-pulse space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-24 bg-gray-200 rounded-lg" />
              ))}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="h-64 bg-gray-200 rounded-lg" />
              <div className="lg:col-span-2 space-y-6">
                <div className="h-48 bg-gray-200 rounded-lg" />
                <div className="h-48 bg-gray-200 rounded-lg" />
              </div>
            </div>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Header title="Dashboard" alertsCount={alertsCount} />
      <main className="flex-1 overflow-y-auto p-6">
        {/* Connection Status Banner */}
        {isOffline && (
          <div className="mb-4 p-3 bg-warning-50 border border-warning-200 rounded-lg flex items-center justify-between">
            <div className="flex items-center text-warning-700">
              <WifiOff className="w-5 h-5 mr-2" />
              <span className="text-sm">
                Unable to connect to backend. Showing cached data.
              </span>
            </div>
            <button
              onClick={handleRefresh}
              className="flex items-center text-sm text-warning-700 hover:text-warning-800"
            >
              <RefreshCw className="w-4 h-4 mr-1" />
              Retry
            </button>
          </div>
        )}

        {/* Stats Grid */}
        <div className={`grid grid-cols-1 md:grid-cols-2 ${canViewFinance ? 'lg:grid-cols-4' : 'lg:grid-cols-2'} gap-4 mb-6`}>
          {canViewFinance && (
            <StatCard
              title="Today's Revenue"
              value={formatCurrency(todayRevenue)}
              icon={Banknote}
              iconColor="text-success-600 bg-success-50"
              trend={summaryData?.revenue ? {
                value: Math.round(((summaryData.revenue.today / (summaryData.revenue.month / 30)) - 1) * 100) || 0,
                isPositive: summaryData.revenue.today > (summaryData.revenue.month / 30)
              } : undefined}
            />
          )}
          <StatCard
            title="Active Machines"
            value={activeMachines}
            subtitle={`of ${totalMachines} total`}
            icon={WashingMachine}
            iconColor="text-primary-600 bg-primary-50"
          />
          <StatCard
            title="Alerts"
            value={alertsCount}
            subtitle="issues to resolve"
            icon={AlertTriangle}
            iconColor={alertsCount > 0 ? "text-danger-600 bg-danger-50" : "text-warning-600 bg-warning-50"}
          />
          {canViewFinance && (
            <StatCard
              title="Month Revenue"
              value={formatCurrency(monthRevenue)}
              icon={TrendingUp}
              iconColor="text-primary-600 bg-primary-50"
              trend={summaryData?.revenue ? {
                value: summaryData.revenue.monthTransactions,
                isPositive: true
              } : undefined}
              subtitle={summaryData?.revenue ? `${summaryData.revenue.monthTransactions} transactions` : undefined}
            />
          )}
        </div>

        {/* Main Content */}
        <div className={`grid grid-cols-1 ${canViewFinance ? 'lg:grid-cols-3' : 'lg:grid-cols-2'} gap-6`}>
          {/* Left Column - Machine Status */}
          <div className="lg:col-span-1">
            <MachineStatusGrid machines={machines} />
          </div>

          {/* Right Column - Transactions & Chart */}
          <div className={`${canViewFinance ? 'lg:col-span-2' : 'lg:col-span-1'} space-y-6`}>
            {canViewFinance && (
              <RevenueChart
                data={weeklyRevenue}
                target={monthRevenue > 0 ? monthRevenue : 500000}
              />
            )}
            <RecentTransactions
              transactions={apiTransactions.length > 0 ? apiTransactions.map(t => {
                const status: 'completed' | 'pending' | 'failed' =
                  t.status === 'SUCCESSFUL' ? 'completed' : t.status === 'PENDING' ? 'pending' : 'failed';
                return {
                  id: t.id,
                  date: new Date(t.createdAt),
                  machineId: t.machineId,
                  machineName: t.machineName || t.machineId,
                  program: `${t.cycleDuration} min`,
                  amount: t.amount,
                  provider: t.paymentProvider,
                  status,
                };
              }) : fallbackTransactions}
            />
          </div>
        </div>

        {/* Feedback Summary - only for users with finance permission */}
        {canViewFinance && summaryData?.feedback?.averageRating && (
          <div className="mt-6 p-4 bg-white rounded-lg shadow-sm border border-gray-200">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Customer Feedback</h3>
            <div className="flex items-center space-x-4">
              <div className="text-2xl font-bold text-primary-600">
                {summaryData.feedback.averageRating}/5
              </div>
              <div className="text-sm text-gray-500">
                Based on {summaryData.feedback.totalReviews} reviews this month
              </div>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
