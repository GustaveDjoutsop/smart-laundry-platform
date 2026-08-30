'use client';

import { useState, useEffect, useCallback } from 'react';
import Header from '@/components/ui/Header';
import { TrendingUp, TrendingDown, Download, RefreshCw, AlertCircle } from 'lucide-react';
import { formatCurrency, cn } from '@/lib/utils';
import { revenueApi } from '@/lib/api';
import type { RevenueSummary, RevenueByProvider, RevenueByProgram, RevenueTrends } from '@/types';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

// Mock data for local development/testing
const mockWeeklyData = [
  { day: 'Mon', revenue: 45000 },
  { day: 'Tue', revenue: 52000 },
  { day: 'Wed', revenue: 48000 },
  { day: 'Thu', revenue: 55000 },
  { day: 'Fri', revenue: 60000 },
  { day: 'Sat', revenue: 70000 },
  { day: 'Sun', revenue: 35000 },
];

const mockMonthlyData = [
  { month: 'Jan', revenue: 1200000 },
  { month: 'Feb', revenue: 1350000 },
  { month: 'Mar', revenue: 1280000 },
  { month: 'Apr', revenue: 1420000 },
  { month: 'May', revenue: 1380000 },
  { month: 'Jun', revenue: 1500000 },
  { month: 'Jul', revenue: 1450000 },
  { month: 'Aug', revenue: 1550000 },
  { month: 'Sep', revenue: 1480000 },
  { month: 'Oct', revenue: 1620000 },
  { month: 'Nov', revenue: 1580000 },
  { month: 'Dec', revenue: 1250000 },
];

const mockProviderData = [
  { name: 'MTN', value: 450000, color: '#FCD34D' },
  { name: 'Orange', value: 380000, color: '#FB923C' },
  { name: 'Wave', value: 220000, color: '#22D3D3' },
  { name: 'CamPay', value: 150000, color: '#3B82F6' },
  { name: 'Nkwa', value: 50000, color: '#A855F7' },
];

const mockProgramData = [
  { program: 'Standard (30 min)', revenue: 520000, count: 173 },
  { program: 'Express (45 min)', revenue: 375000, count: 150 },
  { program: 'Intensif (60 min)', revenue: 280000, count: 70 },
  { program: 'Dryer High', revenue: 75000, count: 38 },
];

const mockSummary: RevenueSummary = {
  period: 'week',
  dateRange: { start: new Date(), end: new Date() },
  current: { total: 365000, transactions: 145, avgTransaction: 2517 },
  previous: { total: 326000, transactions: 130 },
  growth: { amount: 39000, percent: '12.0' },
};

// Provider colors mapping
const providerColors: Record<string, string> = {
  MTN: '#FCD34D',
  mtn: '#FCD34D',
  Orange: '#FB923C',
  orange: '#FB923C',
  Wave: '#22D3D3',
  wave: '#22D3D3',
  CamPay: '#3B82F6',
  campay: '#3B82F6',
  Nkwa: '#A855F7',
  nkwa: '#A855F7',
};

type Period = 'week' | 'month' | 'year';

export default function RevenuePage() {
  const [period, setPeriod] = useState<Period>('week');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usingMockData, setUsingMockData] = useState(false);

  // Data states
  const [summary, setSummary] = useState<RevenueSummary | null>(null);
  const [providerData, setProviderData] = useState<Array<{ name: string; value: number; color: string }>>([]);
  const [programData, setProgramData] = useState<Array<{ program: string; revenue: number; count: number }>>([]);
  const [trendData, setTrendData] = useState<Array<{ label: string; revenue: number }>>([]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Map period to API period format
      const apiPeriod = period === 'week' ? 'week' : period === 'month' ? 'month' : 'year';

      // Fetch all data in parallel
      const [summaryRes, providerRes, programRes, trendsRes] = await Promise.all([
        revenueApi.getSummary(apiPeriod),
        revenueApi.getByProvider(apiPeriod),
        revenueApi.getByProgram(apiPeriod),
        revenueApi.getTrends(period === 'year' ? 12 : 6),
      ]);

      setSummary(summaryRes);

      // Transform provider data for pie chart
      setProviderData(
        providerRes.providers.map((p) => ({
          name: p.provider,
          value: p.revenue,
          color: providerColors[p.provider] || '#6B7280',
        }))
      );

      // Transform program data for bar chart
      setProgramData(
        programRes.programs.map((p) => ({
          program: p.name,
          revenue: p.revenue,
          count: p.transactions,
        }))
      );

      // Transform trend data for area chart
      setTrendData(
        trendsRes.trends.map((t) => ({
          label: t.month,
          revenue: t.revenue,
        }))
      );

      setUsingMockData(false);
    } catch (err) {
      console.error('Failed to fetch revenue data, using mock data:', err);

      // Fall back to mock data
      setSummary(mockSummary);
      setProviderData(mockProviderData);
      setProgramData(mockProgramData);

      // Use appropriate mock trend data based on period
      if (period === 'year') {
        setTrendData(mockMonthlyData.map((d) => ({ label: d.month, revenue: d.revenue })));
      } else {
        setTrendData(mockWeeklyData.map((d) => ({ label: d.day, revenue: d.revenue })));
      }

      setUsingMockData(true);
      setError(null); // Don't show error when we have mock data
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Calculate derived values
  const totalRevenue = summary?.current.total || 0;
  const target = period === 'week' ? 500000 : period === 'month' ? 2000000 : 24000000;
  const progress = (totalRevenue / target) * 100;
  const growthPercent = summary?.growth.percent ? parseFloat(summary.growth.percent) : 0;
  const isPositiveGrowth = growthPercent >= 0;

  // Find best day/month
  const bestPeriod = trendData.reduce(
    (best, current) => (current.revenue > best.revenue ? current : best),
    { label: '-', revenue: 0 }
  );

  // Calculate average
  const avgRevenue = trendData.length > 0 ? totalRevenue / trendData.length : 0;

  // Calculate total from provider data for percentage display
  const totalProviderRevenue = providerData.reduce((sum, p) => sum + p.value, 0);

  return (
    <>
      <Header title="Revenue" />
      <main className="flex-1 overflow-y-auto p-6">
        {/* Mock Data Banner */}
        {usingMockData && (
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center text-blue-700">
            <AlertCircle className="w-5 h-5 mr-2" />
            Using sample data (backend not available)
          </div>
        )}

        {/* Error Banner */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center text-red-700">
            <AlertCircle className="w-5 h-5 mr-2" />
            {error}
            <button
              onClick={fetchData}
              className="ml-auto text-sm underline hover:no-underline"
            >
              Retry
            </button>
          </div>
        )}

        {/* Period Selector */}
        <div className="flex justify-between items-center mb-6">
          <div className="flex space-x-2">
            {(['week', 'month', 'year'] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={cn(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                  period === p
                    ? 'bg-primary-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                )}
              >
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={fetchData}
              disabled={loading}
              className="btn btn-secondary"
            >
              <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
              Refresh
            </button>
            <button className="btn btn-primary">
              <Download className="w-4 h-4 mr-2" />
              Export Report
            </button>
          </div>
        </div>

        {/* Loading State */}
        {loading && !summary ? (
          <div className="animate-pulse space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-32 bg-gray-200 rounded-lg" />
              ))}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="h-80 bg-gray-200 rounded-lg" />
              <div className="h-80 bg-gray-200 rounded-lg" />
            </div>
          </div>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <div className="card">
                <p className="text-sm text-gray-500">
                  This {period.charAt(0).toUpperCase() + period.slice(1)}
                </p>
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  {formatCurrency(totalRevenue)}
                </p>
                <div className={cn(
                  'flex items-center mt-2',
                  isPositiveGrowth ? 'text-success-600' : 'text-red-600'
                )}>
                  {isPositiveGrowth ? (
                    <TrendingUp className="w-4 h-4 mr-1" />
                  ) : (
                    <TrendingDown className="w-4 h-4 mr-1" />
                  )}
                  <span className="text-sm">
                    {isPositiveGrowth ? '+' : ''}{growthPercent.toFixed(1)}% vs last {period}
                  </span>
                </div>
              </div>

              <div className="card">
                <p className="text-sm text-gray-500">
                  {period.charAt(0).toUpperCase() + period.slice(1)}ly Target
                </p>
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  {formatCurrency(target)}
                </p>
                <div className="mt-2">
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={cn(
                        'h-full rounded-full',
                        progress >= 100 ? 'bg-success-500' : 'bg-primary-500'
                      )}
                      style={{ width: `${Math.min(progress, 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{progress.toFixed(1)}% achieved</p>
                </div>
              </div>

              <div className="card">
                <p className="text-sm text-gray-500">Daily Average</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  {formatCurrency(avgRevenue)}
                </p>
                <p className="text-sm text-gray-500 mt-2">
                  Based on {trendData.length} {period === 'year' ? 'months' : 'days'}
                </p>
              </div>

              <div className="card">
                <p className="text-sm text-gray-500">
                  Best {period === 'year' ? 'Month' : 'Day'}
                </p>
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  {bestPeriod.label}
                </p>
                <p className="text-sm text-success-600 mt-2">
                  {formatCurrency(bestPeriod.revenue)} revenue
                </p>
              </div>
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              {/* Revenue Trend */}
              <div className="card">
                <h3 className="card-title mb-4">Revenue Trend</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={trendData}
                      margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis
                        dataKey="label"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: '#6b7280', fontSize: 12 }}
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: '#6b7280', fontSize: 12 }}
                        tickFormatter={(value) => `${(value / 1000).toFixed(0)}K`}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#fff',
                          border: '1px solid #e5e7eb',
                          borderRadius: '8px',
                        }}
                        formatter={(value) => [formatCurrency(Number(value ?? 0)), 'Revenue']}
                      />
                      <Area
                        type="monotone"
                        dataKey="revenue"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        fillOpacity={1}
                        fill="url(#colorRevenue)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Revenue by Provider */}
              <div className="card">
                <h3 className="card-title mb-4">Revenue by Provider</h3>
                <div className="h-64 flex items-center">
                  {providerData.length > 0 ? (
                    <>
                      <div className="w-1/2">
                        <ResponsiveContainer width="100%" height={200}>
                          <PieChart>
                            <Pie
                              data={providerData}
                              cx="50%"
                              cy="50%"
                              innerRadius={50}
                              outerRadius={80}
                              dataKey="value"
                            >
                              {providerData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip
                              formatter={(value) => [formatCurrency(Number(value ?? 0)), 'Revenue']}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="w-1/2 space-y-2">
                        {providerData.map((provider) => (
                          <div key={provider.name} className="flex items-center justify-between">
                            <div className="flex items-center">
                              <div
                                className="w-3 h-3 rounded-full mr-2"
                                style={{ backgroundColor: provider.color }}
                              />
                              <span className="text-sm text-gray-600">{provider.name}</span>
                            </div>
                            <div className="text-right">
                              <span className="text-sm font-medium text-gray-900">
                                {formatCurrency(provider.value)}
                              </span>
                              <span className="text-xs text-gray-500 ml-1">
                                ({totalProviderRevenue > 0 ? ((provider.value / totalProviderRevenue) * 100).toFixed(0) : 0}%)
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="w-full text-center text-gray-500">
                      No provider data available
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Revenue by Program */}
            <div className="card">
              <h3 className="card-title mb-4">Revenue by Program</h3>
              <div className="h-64">
                {programData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={programData}
                      margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis
                        dataKey="program"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: '#6b7280', fontSize: 12 }}
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: '#6b7280', fontSize: 12 }}
                        tickFormatter={(value) => `${(value / 1000).toFixed(0)}K`}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#fff',
                          border: '1px solid #e5e7eb',
                          borderRadius: '8px',
                        }}
                        formatter={(value, name) => {
                          const numericValue = Number(value ?? 0);
                          if (name === 'revenue') return [formatCurrency(numericValue), 'Revenue'];
                          return [numericValue, 'Cycles'];
                        }}
                      />
                      <Bar dataKey="revenue" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-gray-500">
                    No program data available
                  </div>
                )}
              </div>

              {/* Program Details Table */}
              {programData.length > 0 && (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                          Program
                        </th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                          Revenue
                        </th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                          Cycles
                        </th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                          Avg per Cycle
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {programData.map((prog) => (
                        <tr key={prog.program}>
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">
                            {prog.program}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900">
                            {formatCurrency(prog.revenue)}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500">{prog.count}</td>
                          <td className="px-4 py-3 text-sm text-gray-500">
                            {prog.count > 0 ? formatCurrency(Math.round(prog.revenue / prog.count)) : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </>
  );
}
