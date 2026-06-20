'use client';

import { useState } from 'react';
import Header from '@/components/ui/Header';
import {
  FileText,
  Download,
  Calendar,
  TrendingUp,
  TrendingDown,
  DollarSign,
  PieChart,
} from 'lucide-react';
import { formatCurrency, cn } from '@/lib/utils';
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
  Legend,
} from 'recharts';
import type { FinancialReport } from '@/types';

// Mock report data
const mockMonthlyData = [
  { month: 'Jan', revenue: 1200000, expenses: 450000 },
  { month: 'Feb', revenue: 1350000, expenses: 480000 },
  { month: 'Mar', revenue: 1280000, expenses: 520000 },
  { month: 'Apr', revenue: 1420000, expenses: 490000 },
  { month: 'May', revenue: 1380000, expenses: 510000 },
  { month: 'Jun', revenue: 1500000, expenses: 530000 },
  { month: 'Jul', revenue: 1450000, expenses: 500000 },
  { month: 'Aug', revenue: 1550000, expenses: 540000 },
  { month: 'Sep', revenue: 1480000, expenses: 520000 },
  { month: 'Oct', revenue: 1620000, expenses: 560000 },
  { month: 'Nov', revenue: 1580000, expenses: 550000 },
  { month: 'Dec', revenue: 1250000, expenses: 480000 },
];

const mockExpenseBreakdown = [
  { category: 'Electricity', amount: 180000, percentage: 33 },
  { category: 'Water', amount: 85000, percentage: 15 },
  { category: 'Maintenance', amount: 120000, percentage: 22 },
  { category: 'Supplies', amount: 65000, percentage: 12 },
  { category: 'Staff', amount: 75000, percentage: 14 },
  { category: 'Other', amount: 25000, percentage: 4 },
];

const mockPaymentFees = [
  { provider: 'MTN', transactions: 450, fees: 45000, rate: 2.0 },
  { provider: 'Orange', transactions: 380, fees: 38000, rate: 2.0 },
  { provider: 'Wave', transactions: 220, fees: 16500, rate: 1.5 },
  { provider: 'CamPay', transactions: 150, fees: 12000, rate: 1.6 },
  { provider: 'Nkwa', transactions: 50, fees: 4000, rate: 1.6 },
];

type ReportPeriod = 'monthly' | 'quarterly' | 'annual';

export default function ReportsPage() {
  const [period, setPeriod] = useState<ReportPeriod>('monthly');

  const currentMonthRevenue = 1580000;
  const currentMonthExpenses = 550000;
  const currentMonthFees = 115500;
  const netProfit = currentMonthRevenue - currentMonthExpenses - currentMonthFees;
  const profitMargin = (netProfit / currentMonthRevenue) * 100;

  const totalFees = mockPaymentFees.reduce((sum, p) => sum + p.fees, 0);

  return (
    <>
      <Header title="Reports" />
      <main className="flex-1 overflow-y-auto p-6">
        {/* Period Selector & Export */}
        <div className="flex justify-between items-center mb-6">
          <div className="flex space-x-2">
            {(['monthly', 'quarterly', 'annual'] as ReportPeriod[]).map((p) => (
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
          <div className="flex space-x-2">
            <button className="btn btn-secondary">
              <Calendar className="w-4 h-4 mr-2" />
              Select Date Range
            </button>
            <button className="btn btn-primary">
              <Download className="w-4 h-4 mr-2" />
              Export PDF
            </button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Gross Revenue</p>
                <p className="text-2xl font-bold text-gray-900">
                  {formatCurrency(currentMonthRevenue)}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-success-50 text-success-600">
                <TrendingUp className="w-6 h-6" />
              </div>
            </div>
            <p className="text-sm text-success-600 mt-2">+8% vs last month</p>
          </div>

          <div className="card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Total Expenses</p>
                <p className="text-2xl font-bold text-gray-900">
                  {formatCurrency(currentMonthExpenses)}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-danger-50 text-danger-600">
                <TrendingDown className="w-6 h-6" />
              </div>
            </div>
            <p className="text-sm text-danger-600 mt-2">+5% vs last month</p>
          </div>

          <div className="card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Payment Fees</p>
                <p className="text-2xl font-bold text-gray-900">
                  {formatCurrency(currentMonthFees)}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-warning-50 text-warning-600">
                <PieChart className="w-6 h-6" />
              </div>
            </div>
            <p className="text-sm text-gray-500 mt-2">
              {((currentMonthFees / currentMonthRevenue) * 100).toFixed(1)}% of revenue
            </p>
          </div>

          <div className="card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Net Profit</p>
                <p className="text-2xl font-bold text-gray-900">
                  {formatCurrency(netProfit)}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-primary-50 text-primary-600">
                <DollarSign className="w-6 h-6" />
              </div>
            </div>
            <p className="text-sm text-success-600 mt-2">
              {profitMargin.toFixed(1)}% margin
            </p>
          </div>
        </div>

        {/* Revenue vs Expenses Chart */}
        <div className="card mb-6">
          <h3 className="card-title mb-4">Revenue vs Expenses</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={mockMonthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="month"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#6b7280', fontSize: 12 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#6b7280', fontSize: 12 }}
                  tickFormatter={(value) => `${(value / 1000000).toFixed(1)}M`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                  }}
                  formatter={(value: number) => [formatCurrency(value), '']}
                />
                <Legend />
                <Bar dataKey="revenue" name="Revenue" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expenses" name="Expenses" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Expense Breakdown */}
          <div className="card">
            <h3 className="card-title mb-4">Expense Breakdown</h3>
            <div className="space-y-4">
              {mockExpenseBreakdown.map((expense) => (
                <div key={expense.category}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-600">{expense.category}</span>
                    <span className="font-medium text-gray-900">
                      {formatCurrency(expense.amount)}
                    </span>
                  </div>
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary-500 rounded-full"
                      style={{ width: `${expense.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t flex justify-between">
              <span className="font-medium text-gray-900">Total</span>
              <span className="font-bold text-gray-900">
                {formatCurrency(currentMonthExpenses)}
              </span>
            </div>
          </div>

          {/* Payment Provider Fees */}
          <div className="card">
            <h3 className="card-title mb-4">Payment Provider Fees</h3>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                      Provider
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                      Transactions
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                      Rate
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                      Total Fees
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {mockPaymentFees.map((provider) => (
                    <tr key={provider.provider}>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {provider.provider}
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {provider.transactions}
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {provider.rate}%
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {formatCurrency(provider.fees)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50">
                  <tr>
                    <td className="px-4 py-3 font-bold text-gray-900" colSpan={3}>
                      Total Fees
                    </td>
                    <td className="px-4 py-3 font-bold text-gray-900">
                      {formatCurrency(totalFees)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>

        {/* Available Reports */}
        <div className="card mt-6">
          <h3 className="card-title mb-4">Available Reports</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { name: 'Monthly Financial Summary', desc: 'Complete financial overview' },
              { name: 'Transaction Report', desc: 'Detailed transaction history' },
              { name: 'Machine Utilization', desc: 'Usage statistics per machine' },
              { name: 'Maintenance Report', desc: 'Maintenance costs and history' },
              { name: 'Provider Fee Analysis', desc: 'Payment provider comparison' },
              { name: 'Tax Summary', desc: 'VAT and tax documentation' },
            ].map((report) => (
              <div
                key={report.name}
                className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
              >
                <div className="flex items-center">
                  <FileText className="w-5 h-5 text-primary-600 mr-3" />
                  <div>
                    <p className="font-medium text-gray-900">{report.name}</p>
                    <p className="text-xs text-gray-500">{report.desc}</p>
                  </div>
                </div>
                <button className="text-primary-600 hover:text-primary-700">
                  <Download className="w-5 h-5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </main>
    </>
  );
}
