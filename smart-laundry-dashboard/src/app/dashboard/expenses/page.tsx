'use client';

import { useState } from 'react';
import Header from '@/components/ui/Header';
import {
  Plus,
  Receipt,
  DollarSign,
  Calendar,
  Filter,
  Download,
  RefreshCw,
  WifiOff,
  Zap,
  Home,
  Users,
  Wrench,
  Package,
  Megaphone,
  Shield,
  FileText,
  MoreHorizontal,
} from 'lucide-react';
import { formatCurrency, formatDate, cn } from '@/lib/utils';
import { useExpenses } from '@/hooks';
import { ExpenseModal } from '@/components/expenses';
import type { ExpenseCategory } from '@/types';

const categoryConfig: Record<
  ExpenseCategory,
  { label: string; icon: React.ElementType; color: string }
> = {
  utilities: { label: 'Utilities', icon: Zap, color: 'bg-yellow-100 text-yellow-600' },
  rent: { label: 'Rent', icon: Home, color: 'bg-blue-100 text-blue-600' },
  salaries: { label: 'Salaries', icon: Users, color: 'bg-purple-100 text-purple-600' },
  maintenance: { label: 'Maintenance', icon: Wrench, color: 'bg-orange-100 text-orange-600' },
  supplies: { label: 'Supplies', icon: Package, color: 'bg-green-100 text-green-600' },
  marketing: { label: 'Marketing', icon: Megaphone, color: 'bg-pink-100 text-pink-600' },
  insurance: { label: 'Insurance', icon: Shield, color: 'bg-indigo-100 text-indigo-600' },
  taxes: { label: 'Taxes', icon: FileText, color: 'bg-red-100 text-red-600' },
  other: { label: 'Other', icon: MoreHorizontal, color: 'bg-gray-100 text-gray-600' },
};

const allCategories: ExpenseCategory[] = [
  'utilities',
  'rent',
  'salaries',
  'maintenance',
  'supplies',
  'marketing',
  'insurance',
  'taxes',
  'other',
];

export default function ExpensesPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<ExpenseCategory | 'all'>('all');
  const [dateRange, setDateRange] = useState<'week' | 'month' | 'year'>('month');

  // Calculate date range
  const getDateRange = () => {
    const now = new Date();
    const endDate = now.toISOString().split('T')[0];
    let startDate: string;

    switch (dateRange) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split('T')[0];
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1)
          .toISOString()
          .split('T')[0];
        break;
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0];
        break;
    }

    return { startDate, endDate };
  };

  const { startDate, endDate } = getDateRange();

  const {
    data: expensesData,
    loading,
    error,
    refetch,
  } = useExpenses({
    category: selectedCategory === 'all' ? undefined : selectedCategory,
    startDate,
    endDate,
    limit: 50,
  });

  const expenses = expensesData?.expenses || [];
  const summary = expensesData?.summary || {};
  const grandTotal = expensesData?.grandTotal || 0;

  // Calculate category totals for the summary cards
  const categoryTotals = allCategories.reduce((acc, cat) => {
    acc[cat] = summary[cat] || 0;
    return acc;
  }, {} as Record<ExpenseCategory, number>);

  const handleModalSuccess = () => {
    refetch();
  };

  if (loading) {
    return (
      <>
        <Header title="Expenses" />
        <main className="flex-1 overflow-y-auto p-6">
          <div className="animate-pulse space-y-6">
            <div className="flex justify-between">
              <div className="h-10 bg-gray-200 rounded-lg w-64" />
              <div className="h-10 bg-gray-200 rounded-lg w-32" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-24 bg-gray-200 rounded-lg" />
              ))}
            </div>
            <div className="h-96 bg-gray-200 rounded-lg" />
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Header title="Expenses" />
      <main className="flex-1 overflow-y-auto p-6">
        {/* Connection Status Banner */}
        {error && (
          <div className="mb-4 p-3 bg-warning-50 border border-warning-200 rounded-lg flex items-center justify-between">
            <div className="flex items-center text-warning-700">
              <WifiOff className="w-5 h-5 mr-2" />
              <span className="text-sm">Unable to connect to backend.</span>
            </div>
            <button
              onClick={() => refetch()}
              className="flex items-center text-sm text-warning-700 hover:text-warning-800"
            >
              <RefreshCw className="w-4 h-4 mr-1" />
              Retry
            </button>
          </div>
        )}

        {/* Header Actions */}
        <div className="flex flex-wrap gap-4 justify-between items-center mb-6">
          <div className="flex items-center space-x-2">
            {/* Date Range Filter */}
            <div className="flex bg-gray-100 rounded-lg p-1">
              {(['week', 'month', 'year'] as const).map((range) => (
                <button
                  key={range}
                  onClick={() => setDateRange(range)}
                  className={cn(
                    'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
                    dateRange === range
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  )}
                >
                  {range === 'week' ? 'This Week' : range === 'month' ? 'This Month' : 'This Year'}
                </button>
              ))}
            </div>

            {/* Category Filter */}
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value as ExpenseCategory | 'all')}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
            >
              <option value="all">All Categories</option>
              {allCategories.map((cat) => (
                <option key={cat} value={cat}>
                  {categoryConfig[cat].label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center space-x-2">
            <button className="btn btn-secondary">
              <Download className="w-4 h-4 mr-2" />
              Export
            </button>
            <button onClick={() => setIsModalOpen(true)} className="btn btn-primary">
              <Plus className="w-4 h-4 mr-2" />
              Add Expense
            </button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
          {/* Total Card */}
          <div className="card bg-primary-50 border-primary-200">
            <div className="flex items-center">
              <div className="p-2 rounded-lg bg-primary-100 text-primary-600 mr-3">
                <DollarSign className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-primary-600 font-medium">Total Expenses</p>
                <p className="text-lg font-bold text-primary-900">{formatCurrency(grandTotal)}</p>
              </div>
            </div>
          </div>

          {/* Top Category Cards */}
          {allCategories
            .filter((cat) => categoryTotals[cat] > 0)
            .sort((a, b) => categoryTotals[b] - categoryTotals[a])
            .slice(0, 4)
            .map((cat) => {
              const config = categoryConfig[cat];
              const Icon = config.icon;
              return (
                <div key={cat} className="card">
                  <div className="flex items-center">
                    <div className={cn('p-2 rounded-lg mr-3', config.color)}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 font-medium">{config.label}</p>
                      <p className="text-lg font-bold text-gray-900">
                        {formatCurrency(categoryTotals[cat])}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
        </div>

        {/* Category Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          {/* Category Summary */}
          <div className="card">
            <h3 className="card-title mb-4">Category Breakdown</h3>
            <div className="space-y-3">
              {allCategories
                .filter((cat) => categoryTotals[cat] > 0)
                .sort((a, b) => categoryTotals[b] - categoryTotals[a])
                .map((cat) => {
                  const config = categoryConfig[cat];
                  const Icon = config.icon;
                  const percentage = grandTotal > 0 ? (categoryTotals[cat] / grandTotal) * 100 : 0;
                  return (
                    <div key={cat}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center">
                          <div className={cn('p-1.5 rounded mr-2', config.color)}>
                            <Icon className="w-3.5 h-3.5" />
                          </div>
                          <span className="text-sm text-gray-700">{config.label}</span>
                        </div>
                        <span className="text-sm font-medium text-gray-900">
                          {formatCurrency(categoryTotals[cat])}
                        </span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary-500 rounded-full transition-all"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              {allCategories.every((cat) => categoryTotals[cat] === 0) && (
                <p className="text-sm text-gray-500 text-center py-4">No expenses recorded</p>
              )}
            </div>
          </div>

          {/* Recent Expenses List */}
          <div className="card lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h3 className="card-title">Recent Expenses</h3>
              <span className="text-sm text-gray-500">{expenses.length} records</span>
            </div>

            {expenses.length === 0 ? (
              <div className="text-center py-12">
                <Receipt className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900">No Expenses Yet</h3>
                <p className="text-gray-500 mb-4">Start recording your business expenses</p>
                <button onClick={() => setIsModalOpen(true)} className="btn btn-primary">
                  <Plus className="w-4 h-4 mr-2" />
                  Add First Expense
                </button>
              </div>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {expenses.map((expense) => {
                  const config = categoryConfig[expense.category];
                  const Icon = config.icon;
                  return (
                    <div
                      key={expense.id}
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      <div className="flex items-center">
                        <div className={cn('p-2 rounded-lg mr-3', config.color)}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{expense.description}</p>
                          <div className="flex items-center space-x-2 text-xs text-gray-500">
                            <span>{formatDate(new Date(expense.date))}</span>
                            {expense.vendor && (
                              <>
                                <span>•</span>
                                <span>{expense.vendor}</span>
                              </>
                            )}
                            {expense.receiptNumber && (
                              <>
                                <span>•</span>
                                <span>#{expense.receiptNumber}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-gray-900">
                          {formatCurrency(expense.amount)}
                        </p>
                        <span
                          className={cn(
                            'text-xs px-2 py-0.5 rounded-full',
                            config.color
                          )}
                        >
                          {config.label}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Quick Add Cards */}
        <div className="card">
          <h3 className="card-title mb-4">Quick Add Common Expenses</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {[
              { category: 'utilities', label: 'Electricity Bill', icon: Zap },
              { category: 'utilities', label: 'Water Bill', icon: Zap },
              { category: 'rent', label: 'Monthly Rent', icon: Home },
              { category: 'salaries', label: 'Staff Wages', icon: Users },
              { category: 'supplies', label: 'Detergent', icon: Package },
              { category: 'maintenance', label: 'Repair Cost', icon: Wrench },
            ].map((item, index) => {
              const Icon = item.icon;
              return (
                <button
                  key={index}
                  onClick={() => setIsModalOpen(true)}
                  className="flex flex-col items-center p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <Icon className="w-6 h-6 text-gray-600 mb-2" />
                  <span className="text-sm font-medium text-gray-700 text-center">
                    {item.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </main>

      {/* Expense Modal */}
      <ExpenseModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={handleModalSuccess}
      />
    </>
  );
}
