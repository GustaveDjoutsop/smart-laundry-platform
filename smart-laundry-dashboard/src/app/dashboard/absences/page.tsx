'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Filter, RefreshCw, Users, Calendar } from 'lucide-react';
import Header from '@/components/ui/Header';
import {
  AbsenceTable,
  AbsenceFormModal,
  AbsenceSummaryCard,
} from '@/components/absences';
import { absencesApi, usersApi } from '@/lib/api';
import { useAuth, hasPermission } from '@/lib/auth';
import type { Absence, AbsenceSummary, AbsenceStatus, AbsenceType } from '@/components/absences/types';

export default function AbsencesPage() {
  const { user } = useAuth();

  // Permissions
  const canApprove = user ? hasPermission(user, 'absences:approve') : false;

  // State
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [summary, setSummary] = useState<AbsenceSummary | null>(null);
  const [employees, setEmployees] = useState<Array<{ _id: string; name: string; email: string }>>([]);
  const [pendingCount, setPendingCount] = useState(0);

  // Loading states
  const [absencesLoading, setAbsencesLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);

  // Modals
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingAbsence, setEditingAbsence] = useState<Absence | null>(null);

  // Filters
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<AbsenceStatus | ''>('');
  const [selectedType, setSelectedType] = useState<AbsenceType | ''>('');
  const currentYear = new Date().getFullYear();

  // Get date range (default to current year)
  const getDefaultDates = () => {
    const start = new Date(currentYear, 0, 1);
    const end = new Date(currentYear, 11, 31);
    return {
      startDate: start.toISOString().split('T')[0],
      endDate: end.toISOString().split('T')[0],
    };
  };

  const [dateRange, setDateRange] = useState(getDefaultDates());

  // Fetch absences
  const fetchAbsences = useCallback(async () => {
    setAbsencesLoading(true);
    try {
      const response = await absencesApi.getAll({
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        employeeId: selectedEmployeeId || undefined,
        status: selectedStatus || undefined,
        type: selectedType || undefined,
      });
      setAbsences(response.absences);
    } catch (error) {
      console.error('Failed to fetch absences:', error);
    } finally {
      setAbsencesLoading(false);
    }
  }, [dateRange, selectedEmployeeId, selectedStatus, selectedType]);

  // Fetch summary for current user
  const fetchSummary = useCallback(async () => {
    if (!user) return;
    setSummaryLoading(true);
    try {
      const response = await absencesApi.getEmployeeSummary(user.id, currentYear);
      setSummary(response.summary);
    } catch (error) {
      console.error('Failed to fetch summary:', error);
    } finally {
      setSummaryLoading(false);
    }
  }, [user, currentYear]);

  // Fetch employees (for managers)
  const fetchEmployees = useCallback(async () => {
    if (!canApprove) return;
    try {
      const response = await usersApi.getAll({ isActive: true });
      setEmployees(response.users.map((u) => ({ _id: u.id, name: u.name, email: u.email })));
    } catch (error) {
      console.error('Failed to fetch employees:', error);
    }
  }, [canApprove]);

  // Fetch pending count (for managers)
  const fetchPendingCount = useCallback(async () => {
    if (!canApprove) return;
    try {
      const response = await absencesApi.getPendingCount();
      setPendingCount(response.count);
    } catch (error) {
      console.error('Failed to fetch pending count:', error);
    }
  }, [canApprove]);

  // Initial data fetch
  useEffect(() => {
    fetchAbsences();
    fetchSummary();
    fetchEmployees();
    fetchPendingCount();
  }, [fetchAbsences, fetchSummary, fetchEmployees, fetchPendingCount]);

  // Create absence handler
  const handleCreateAbsence = async (data: {
    employeeId?: string;
    type: AbsenceType;
    startDate: string;
    endDate: string;
    reason?: string;
  }) => {
    if (editingAbsence) {
      await absencesApi.update(editingAbsence._id, data);
    } else {
      await absencesApi.create(data);
    }
    setEditingAbsence(null);
    fetchAbsences();
    fetchSummary();
    fetchPendingCount();
  };

  // Approve handler
  const handleApprove = async (id: string, notes?: string) => {
    await absencesApi.approve(id, notes);
    fetchAbsences();
    fetchPendingCount();
  };

  // Reject handler
  const handleReject = async (id: string, notes: string) => {
    await absencesApi.reject(id, notes);
    fetchAbsences();
    fetchPendingCount();
  };

  // Delete handler
  const handleDelete = async (id: string) => {
    await absencesApi.delete(id);
    fetchAbsences();
    fetchSummary();
    fetchPendingCount();
  };

  // Edit handler
  const handleEdit = (absence: Absence) => {
    setEditingAbsence(absence);
    setShowFormModal(true);
  };

  // Refresh all data
  const handleRefresh = () => {
    fetchAbsences();
    fetchSummary();
    fetchPendingCount();
  };

  // Close modal
  const handleCloseModal = () => {
    setShowFormModal(false);
    setEditingAbsence(null);
  };

  return (
    <>
      <Header
        title={canApprove && pendingCount > 0 ? `Absences (${pendingCount} pending)` : 'Absences'}
      />
      <main className="flex-1 overflow-y-auto p-6">
        {/* Action Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex flex-wrap items-center gap-4">
            {/* Employee Filter (managers only) */}
            {canApprove && (
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

            {/* Status Filter */}
            <div className="flex items-center gap-2">
              <Filter className="w-5 h-5 text-gray-400" />
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value as AbsenceStatus | '')}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="">All Statuses</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>

            {/* Type Filter */}
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value as AbsenceType | '')}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="">All Types</option>
              <option value="vacation">Vacation</option>
              <option value="sick">Sick Leave</option>
              <option value="personal">Personal</option>
              <option value="unpaid_leave">Unpaid Leave</option>
              <option value="family_emergency">Family Emergency</option>
              <option value="training">Training</option>
            </select>

            {/* Date Range */}
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-gray-400" />
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

            <button
              onClick={() => setShowFormModal(true)}
              className="flex items-center px-4 py-2 text-white bg-primary-600 rounded-lg hover:bg-primary-700"
            >
              <Plus className="w-4 h-4 mr-2" />
              Request Absence
            </button>
          </div>
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Summary */}
          <div>
            <AbsenceSummaryCard
              summary={summary}
              isLoading={summaryLoading}
              year={currentYear}
            />
          </div>

          {/* Right Column - Table */}
          <div className="lg:col-span-2">
            <AbsenceTable
              absences={absences}
              isLoading={absencesLoading}
              showEmployee={true}
              canApprove={canApprove}
              currentUserId={user?.id}
              onApprove={handleApprove}
              onReject={handleReject}
              onDelete={handleDelete}
              onEdit={handleEdit}
            />
          </div>
        </div>
      </main>

      {/* Form Modal */}
      <AbsenceFormModal
        isOpen={showFormModal}
        onClose={handleCloseModal}
        onSubmit={handleCreateAbsence}
        employees={canApprove ? employees : undefined}
        canAssignToOthers={canApprove}
        editingAbsence={editingAbsence}
      />
    </>
  );
}
