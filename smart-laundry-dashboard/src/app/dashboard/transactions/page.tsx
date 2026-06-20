'use client';

import { useState, useEffect, useCallback } from 'react';
import Header from '@/components/ui/Header';
import DateRangePicker from '@/components/ui/DateRangePicker';
import { Download, Search, RefreshCw, AlertCircle } from 'lucide-react';
import { formatCurrency, formatDate, cn } from '@/lib/utils';
import { transactionsApi } from '@/lib/api';
import { format } from 'date-fns';
import type { Transaction } from '@/types';

interface DateRange {
  startDate: Date | null;
  endDate: Date | null;
}

// Mock data for local development/testing
const mockTransactions: Transaction[] = Array.from({ length: 50 }, (_, i) => {
  // Spread transactions across multiple months for testing
  const daysAgo = i * 2; // Each transaction 2 days apart
  const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);

  return {
    id: `t${i + 1}`,
    externalReference: `REF${Date.now()}-${i}`,
    machineId: `washer_0${(i % 6) + 1}`,
    machineName: `Washer ${(i % 6) + 1}`,
    amount: [2500, 3000, 4000][i % 3],
    cycleDuration: [30, 45, 60][i % 3],
    pulseCount: 1,
    paymentProvider: ['campay', 'mtn'][i % 2] as 'campay' | 'mtn',
    status: i === 3 ? 'PENDING' : i === 7 ? 'FAILED' : 'SUCCESSFUL',
    cycleStatus: 'COMPLETED',
    phoneNumber: `6${String(Math.random()).slice(2, 10)}`,
    createdAt: date,
  } as Transaction;
});

const providerColors: Record<string, string> = {
  campay: 'bg-blue-100 text-blue-700',
  mtn: 'bg-yellow-100 text-yellow-700',
  MTN: 'bg-yellow-100 text-yellow-700',
  Orange: 'bg-orange-100 text-orange-700',
  Wave: 'bg-cyan-100 text-cyan-700',
  CamPay: 'bg-blue-100 text-blue-700',
  Nkwa: 'bg-purple-100 text-purple-700',
};

const statusColors: Record<string, string> = {
  SUCCESSFUL: 'badge-success',
  PENDING: 'badge-warning',
  FAILED: 'badge-danger',
  completed: 'badge-success',
  pending: 'badge-warning',
  failed: 'badge-danger',
};

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usingMockData, setUsingMockData] = useState(false);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, pages: 0 });

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [dateRange, setDateRange] = useState<DateRange>({ startDate: null, endDate: null });

  // Format date range for API
  const getFormattedDateRange = useCallback(() => {
    return {
      startDate: dateRange.startDate ? format(dateRange.startDate, 'yyyy-MM-dd') : undefined,
      endDate: dateRange.endDate ? format(dateRange.endDate, 'yyyy-MM-dd') : undefined,
    };
  }, [dateRange]);

  // Filter mock data locally
  const filterMockData = useCallback(() => {
    let filtered = [...mockTransactions];

    // Apply date filter
    if (dateRange.startDate || dateRange.endDate) {
      filtered = filtered.filter(txn => {
        const txnDate = new Date(txn.createdAt);
        if (dateRange.startDate && txnDate < dateRange.startDate) return false;
        if (dateRange.endDate && txnDate > dateRange.endDate) return false;
        return true;
      });
    }

    // Apply status filter
    if (statusFilter) {
      filtered = filtered.filter(txn => txn.status === statusFilter);
    }

    // Apply search filter
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      filtered = filtered.filter(txn =>
        txn.machineName?.toLowerCase().includes(search) ||
        txn.externalReference?.toLowerCase().includes(search) ||
        txn.phoneNumber?.includes(search)
      );
    }

    return filtered;
  }, [dateRange, statusFilter, searchTerm]);

  const fetchTransactions = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const { startDate, endDate } = getFormattedDateRange();

      const response = await transactionsApi.getAll({
        page: pagination.page,
        limit: pagination.limit,
        status: statusFilter as 'PENDING' | 'SUCCESSFUL' | 'FAILED' | undefined || undefined,
        search: searchTerm || undefined,
        startDate,
        endDate,
      });

      setTransactions(response.transactions);
      setPagination(prev => ({
        ...prev,
        total: response.pagination.total,
        pages: response.pagination.pages,
      }));
      setUsingMockData(false);
    } catch (err) {
      console.error('Failed to fetch transactions, using mock data:', err);
      // Fall back to mock data
      const filtered = filterMockData();
      setTransactions(filtered);
      setPagination(prev => ({
        ...prev,
        total: filtered.length,
        pages: Math.ceil(filtered.length / prev.limit),
      }));
      setUsingMockData(true);
      setError(null); // Don't show error when we have mock data
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.limit, statusFilter, searchTerm, getFormattedDateRange, filterMockData]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  // Reset page when filters change
  const handleFilterChange = (setter: (value: string) => void, value: string) => {
    setter(value);
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  // Handle date range change
  const handleDateRangeChange = (range: DateRange) => {
    setDateRange(range);
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  // Handle export
  const handleExport = async () => {
    try {
      const { startDate, endDate } = getFormattedDateRange();
      const blob = await transactionsApi.export({
        startDate,
        endDate,
        format: 'csv',
      });

      // Create download link
      const url = window.URL.createObjectURL(new Blob([blob]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `transactions_${format(new Date(), 'yyyy-MM-dd')}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      console.error('Export failed:', err);
    }
  };

  // Calculate total for displayed transactions
  const totalAmount = transactions.reduce((sum, txn) =>
    txn.status === 'SUCCESSFUL' ? sum + txn.amount : sum, 0
  );

  // Get current page of transactions for mock data
  const displayedTransactions = usingMockData
    ? transactions.slice((pagination.page - 1) * pagination.limit, pagination.page * pagination.limit)
    : transactions;

  return (
    <>
      <Header title="Transactions" />
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
              onClick={fetchTransactions}
              className="ml-auto text-sm underline hover:no-underline"
            >
              Retry
            </button>
          </div>
        )}

        {/* Filters */}
        <div className="card mb-6">
          <div className="flex flex-wrap gap-4 items-center">
            {/* Search */}
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by phone, reference..."
                  value={searchTerm}
                  onChange={(e) => handleFilterChange(setSearchTerm, e.target.value)}
                  className="input pl-10"
                />
              </div>
            </div>

            {/* Date Range Picker */}
            <DateRangePicker
              value={dateRange}
              onChange={handleDateRangeChange}
            />

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => handleFilterChange(setStatusFilter, e.target.value)}
              className="input w-auto"
            >
              <option value="">All Status</option>
              <option value="SUCCESSFUL">Successful</option>
              <option value="PENDING">Pending</option>
              <option value="FAILED">Failed</option>
            </select>

            {/* Refresh Button */}
            <button
              onClick={fetchTransactions}
              disabled={loading}
              className="btn btn-secondary"
            >
              <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
              Refresh
            </button>

            {/* Export Button */}
            <button onClick={handleExport} className="btn btn-primary">
              <Download className="w-4 h-4 mr-2" />
              Export
            </button>
          </div>
        </div>

        {/* Summary */}
        <div className="flex justify-between items-center mb-4">
          <p className="text-sm text-gray-500">
            {loading ? 'Loading...' : `Showing ${displayedTransactions.length} of ${pagination.total} transactions`}
          </p>
          <p className="text-sm font-medium text-gray-900">
            Total (Successful): {formatCurrency(totalAmount)}
          </p>
        </div>

        {/* Transactions Table */}
        <div className="card overflow-hidden">
          {loading && !transactions.length ? (
            <div className="p-8 text-center">
              <RefreshCw className="w-8 h-8 text-gray-400 animate-spin mx-auto mb-2" />
              <p className="text-gray-500">Loading transactions...</p>
            </div>
          ) : displayedTransactions.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-gray-500">No transactions found</p>
              <p className="text-sm text-gray-400 mt-1">
                Try adjusting your filters or date range
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Date & Time
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Machine
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Duration
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Provider
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Phone
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Amount
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {displayedTransactions.map((txn) => (
                    <tr key={txn.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {formatDate(new Date(txn.createdAt))}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {txn.machineName || txn.machineId}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {txn.cycleDuration} min
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('badge', providerColors[txn.paymentProvider] || 'bg-gray-100 text-gray-700')}>
                          {txn.paymentProvider}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {txn.phoneNumber}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">
                        {formatCurrency(txn.amount)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('badge', statusColors[txn.status])}>
                          {txn.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        {pagination.pages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-4">
            <button
              onClick={() => setPagination(prev => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
              disabled={pagination.page === 1}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="text-sm text-gray-600">
              Page {pagination.page} of {pagination.pages}
            </span>
            <button
              onClick={() => setPagination(prev => ({ ...prev, page: Math.min(prev.pages, prev.page + 1) }))}
              disabled={pagination.page === pagination.pages}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        )}
      </main>
    </>
  );
}
