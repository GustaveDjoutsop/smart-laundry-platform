'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Filter, RefreshCw, Users } from 'lucide-react';
import Header from '@/components/ui/Header';
import {
  TimeClockCard,
  TimeEntryTable,
  TimeEntrySummaryCard,
  ManualEntryModal,
} from '@/components/timekeeping';
import { timekeepingApi, usersApi } from '@/lib/api';
import { useAuth, hasPermission } from '@/lib/auth';
import type { ClockStatus, TimeEntry, TimeEntrySummary } from '@/components/timekeeping/types';

export default function TimekeepingPage() {
  const { user } = useAuth();

  // Permissions
  const canManageTimekeeping = user ? hasPermission(user, 'timekeeping:manage') : false;
  const canViewAll = user ? hasPermission(user, 'timekeeping:view_all') : false;

  // State
  const [clockStatus, setClockStatus] = useState<ClockStatus | null>(null);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [summary, setSummary] = useState<TimeEntrySummary | null>(null);
  const [employees, setEmployees] = useState<Array<{ _id: string; name: string; email: string }>>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');

  // Loading states
  const [statusLoading, setStatusLoading] = useState(true);
  const [entriesLoading, setEntriesLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);

  // Modals
  const [showManualEntryModal, setShowManualEntryModal] = useState(false);

  // Date filter (default to last 7 days)
  const getDefaultDates = () => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 7);
    return {
      startDate: start.toISOString().split('T')[0],
      endDate: end.toISOString().split('T')[0],
    };
  };

  const [dateRange, setDateRange] = useState(getDefaultDates());

  // Fetch clock status
  const fetchClockStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const response = await timekeepingApi.getStatus();
      setClockStatus(response.status);
    } catch (error) {
      console.error('Failed to fetch clock status:', error);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  // Fetch entries
  const fetchEntries = useCallback(async () => {
    setEntriesLoading(true);
    try {
      const response = await timekeepingApi.getEntries({
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        employeeId: canViewAll && selectedEmployeeId ? selectedEmployeeId : undefined,
      });
      setEntries(response.entries);
    } catch (error) {
      console.error('Failed to fetch entries:', error);
    } finally {
      setEntriesLoading(false);
    }
  }, [dateRange, selectedEmployeeId, canViewAll]);

  // Fetch summary
  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const response = await timekeepingApi.getSummary({
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        employeeId: canViewAll && selectedEmployeeId ? selectedEmployeeId : undefined,
      });
      setSummary(response.summary);
    } catch (error) {
      console.error('Failed to fetch summary:', error);
    } finally {
      setSummaryLoading(false);
    }
  }, [dateRange, selectedEmployeeId, canViewAll]);

  // Fetch employees (for managers)
  const fetchEmployees = useCallback(async () => {
    if (!canViewAll) return;
    try {
      const response = await usersApi.getAll({ isActive: true });
      setEmployees(response.users.map((u) => ({ _id: u.id, name: u.name, email: u.email })));
    } catch (error) {
      console.error('Failed to fetch employees:', error);
    }
  }, [canViewAll]);

  // Initial data fetch
  useEffect(() => {
    fetchClockStatus();
    fetchEntries();
    fetchSummary();
    fetchEmployees();
  }, [fetchClockStatus, fetchEntries, fetchSummary, fetchEmployees]);

  // Refetch entries and summary when filters change
  useEffect(() => {
    fetchEntries();
    fetchSummary();
  }, [dateRange, selectedEmployeeId, fetchEntries, fetchSummary]);

  // Clock in handler
  const handleClockIn = async () => {
    await timekeepingApi.clockIn();
    fetchClockStatus();
    fetchEntries();
    fetchSummary();
  };

  // Clock out handler
  const handleClockOut = async () => {
    await timekeepingApi.clockOut();
    fetchClockStatus();
    fetchEntries();
    fetchSummary();
  };

  // Delete entry handler
  const handleDeleteEntry = async (id: string) => {
    await timekeepingApi.deleteEntry(id);
    fetchEntries();
    fetchSummary();
  };

  // Manual entry handler
  const handleManualEntry = async (data: {
    employeeId: string;
    type: 'clock_in' | 'clock_out';
    timestamp: string;
    notes?: string;
  }) => {
    await timekeepingApi.createManualEntry(data);
    fetchEntries();
    fetchSummary();
  };

  // Refresh all data
  const handleRefresh = () => {
    fetchClockStatus();
    fetchEntries();
    fetchSummary();
  };

  return (
    <>
      <Header title="Timekeeping" />
      <main className="flex-1 overflow-y-auto p-6">
        {/* Action Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            {/* Employee Filter (managers only) */}
            {canViewAll && (
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-gray-400" />
                <select
                  value={selectedEmployeeId}
                  onChange={(e) => setSelectedEmployeeId(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                >
                  <option value="">All Employees</option>
                  {employees.map((emp) => (
                    <option key={emp._id} value={emp._id}>
                      {emp.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Date Range Filter */}
            <div className="flex items-center gap-2">
              <Filter className="w-5 h-5 text-gray-400" />
              <input
                type="date"
                value={dateRange.startDate}
                onChange={(e) => setDateRange((prev) => ({ ...prev, startDate: e.target.value }))}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
              <span className="text-gray-500">to</span>
              <input
                type="date"
                value={dateRange.endDate}
                onChange={(e) => setDateRange((prev) => ({ ...prev, endDate: e.target.value }))}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              className="flex items-center px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </button>

            {canManageTimekeeping && (
              <button
                onClick={() => setShowManualEntryModal(true)}
                className="flex items-center px-4 py-2 text-white bg-primary-600 rounded-lg hover:bg-primary-700"
              >
                <Plus className="w-4 h-4 mr-2" />
                Manual Entry
              </button>
            )}
          </div>
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Clock Card & Summary */}
          <div className="space-y-6">
            <TimeClockCard
              status={clockStatus}
              isLoading={statusLoading}
              onClockIn={handleClockIn}
              onClockOut={handleClockOut}
            />
            <TimeEntrySummaryCard summary={summary} isLoading={summaryLoading} />
          </div>

          {/* Right Column - Entries Table */}
          <div className="lg:col-span-2">
            <TimeEntryTable
              entries={entries}
              isLoading={entriesLoading}
              showEmployee={canViewAll}
              canManage={canManageTimekeeping}
              onDelete={canManageTimekeeping ? handleDeleteEntry : undefined}
            />
          </div>
        </div>
      </main>

      {/* Manual Entry Modal */}
      <ManualEntryModal
        isOpen={showManualEntryModal}
        onClose={() => setShowManualEntryModal(false)}
        onSubmit={handleManualEntry}
        employees={employees}
      />
    </>
  );
}
