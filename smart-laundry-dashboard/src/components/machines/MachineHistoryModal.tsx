'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import {
  WashingMachine,
  Wind,
  TrendingUp,
  Clock,
  DollarSign,
  Activity,
  AlertTriangle,
  Wrench,
  Calendar,
  RefreshCw,
} from 'lucide-react';
import { formatCurrency, formatDate, cn } from '@/lib/utils';
import { useMachineHistory, useMaintenanceHistory } from '@/hooks';
import type { MachineStatus, Transaction } from '@/types';

interface MachineHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  machine: MachineStatus | null;
}

type TabType = 'transactions' | 'stats' | 'maintenance';

export function MachineHistoryModal({
  isOpen,
  onClose,
  machine,
}: MachineHistoryModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('transactions');
  const [period, setPeriod] = useState<'week' | 'month' | 'year'>('month');

  // Fetch machine history
  const {
    data: historyData,
    loading: historyLoading,
    error: historyError,
    refetch: refetchHistory,
  } = useMachineHistory(machine?.id || '', { period });

  // Fetch maintenance history for this machine
  const {
    data: maintenanceData,
    loading: maintenanceLoading,
  } = useMaintenanceHistory({ machineId: machine?.id, limit: 10 });

  const transactions = historyData?.transactions || [];
  const dailyStats = historyData?.dailyStats || [];
  const maintenanceRecords = maintenanceData?.maintenance || [];

  // Calculate summary stats
  const totalRevenue = transactions.reduce((sum, t) => sum + (t.amount || 0), 0);
  const totalCycles = transactions.length;
  const avgRevenuePerCycle = totalCycles > 0 ? totalRevenue / totalCycles : 0;

  if (!machine) return null;

  const MachineIcon = machine.type === 'washer' ? WashingMachine : Wind;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${machine.name} History`}
      description="View usage statistics, transactions, and maintenance history"
      size="xl"
    >
      <div className="space-y-6">
        {/* Machine Info Header */}
        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
          <div className="flex items-center">
            <div
              className={cn(
                'p-3 rounded-lg mr-4',
                machine.type === 'washer'
                  ? 'bg-primary-100 text-primary-600'
                  : 'bg-warning-100 text-warning-600'
              )}
            >
              <MachineIcon className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">{machine.name}</h3>
              <p className="text-sm text-gray-500 capitalize">
                {machine.type} • {(machine.totalCycles ?? 0).toLocaleString()} total cycles
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <span
              className={cn(
                'px-3 py-1 rounded-full text-sm font-medium',
                machine.status === 'available' && 'bg-success-100 text-success-700',
                machine.status === 'in_use' && 'bg-primary-100 text-primary-700',
                machine.status === 'error' && 'bg-danger-100 text-danger-700',
                machine.status === 'maintenance' && 'bg-warning-100 text-warning-700'
              )}
            >
              {machine.status.replace('_', ' ')}
            </span>
          </div>
        </div>

        {/* Period Selector */}
        <div className="flex items-center justify-between">
          <div className="flex bg-gray-100 rounded-lg p-1">
            {(['week', 'month', 'year'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={cn(
                  'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
                  period === p
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                )}
              >
                {p === 'week' ? 'This Week' : p === 'month' ? 'This Month' : 'This Year'}
              </button>
            ))}
          </div>
          <button
            onClick={() => refetchHistory()}
            className="p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-4 gap-4">
          <div className="p-4 bg-primary-50 rounded-lg">
            <div className="flex items-center">
              <DollarSign className="w-5 h-5 text-primary-600 mr-2" />
              <span className="text-sm text-primary-600">Revenue</span>
            </div>
            <p className="text-xl font-bold text-primary-900 mt-1">
              {formatCurrency(totalRevenue)}
            </p>
          </div>
          <div className="p-4 bg-success-50 rounded-lg">
            <div className="flex items-center">
              <Activity className="w-5 h-5 text-success-600 mr-2" />
              <span className="text-sm text-success-600">Cycles</span>
            </div>
            <p className="text-xl font-bold text-success-900 mt-1">{totalCycles}</p>
          </div>
          <div className="p-4 bg-warning-50 rounded-lg">
            <div className="flex items-center">
              <TrendingUp className="w-5 h-5 text-warning-600 mr-2" />
              <span className="text-sm text-warning-600">Avg/Cycle</span>
            </div>
            <p className="text-xl font-bold text-warning-900 mt-1">
              {formatCurrency(avgRevenuePerCycle)}
            </p>
          </div>
          <div className="p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center">
              <Clock className="w-5 h-5 text-gray-600 mr-2" />
              <span className="text-sm text-gray-600">Utilization</span>
            </div>
            <p className="text-xl font-bold text-gray-900 mt-1">
              {machine.utilizationRate ?? 0}%
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200">
          <nav className="flex space-x-4">
            {[
              { id: 'transactions', label: 'Transactions', icon: DollarSign },
              { id: 'stats', label: 'Daily Stats', icon: Activity },
              { id: 'maintenance', label: 'Maintenance', icon: Wrench },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabType)}
                className={cn(
                  'flex items-center px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                  activeTab === tab.id
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                )}
              >
                <tab.icon className="w-4 h-4 mr-2" />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="min-h-[300px] max-h-[400px] overflow-y-auto">
          {historyLoading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-6 h-6 text-gray-400 animate-spin" />
            </div>
          ) : historyError ? (
            <div className="text-center py-12">
              <AlertTriangle className="w-12 h-12 text-warning-400 mx-auto mb-4" />
              <p className="text-gray-600">Unable to load history data</p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => refetchHistory()}
                className="mt-4"
              >
                Try Again
              </Button>
            </div>
          ) : (
            <>
              {/* Transactions Tab */}
              {activeTab === 'transactions' && (
                <div className="space-y-2">
                  {transactions.length === 0 ? (
                    <div className="text-center py-12">
                      <DollarSign className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                      <p className="text-gray-500">No transactions in this period</p>
                    </div>
                  ) : (
                    transactions.slice(0, 20).map((transaction: Transaction) => (
                      <div
                        key={transaction.id}
                        className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                      >
                        <div className="flex items-center">
                          <div
                            className={cn(
                              'w-2 h-2 rounded-full mr-3',
                              transaction.status === 'SUCCESSFUL' && 'bg-success-500',
                              transaction.status === 'PENDING' && 'bg-warning-500',
                              transaction.status === 'FAILED' && 'bg-danger-500'
                            )}
                          />
                          <div>
                            <p className="text-sm font-medium text-gray-900">
                              {transaction.description || `${transaction.cycleDuration} min cycle`}
                            </p>
                            <p className="text-xs text-gray-500">
                              {formatDate(new Date(transaction.createdAt))} •{' '}
                              {transaction.paymentProvider}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-gray-900">
                            {formatCurrency(transaction.amount)}
                          </p>
                          <span
                            className={cn(
                              'text-xs',
                              transaction.status === 'SUCCESSFUL' && 'text-success-600',
                              transaction.status === 'PENDING' && 'text-warning-600',
                              transaction.status === 'FAILED' && 'text-danger-600'
                            )}
                          >
                            {transaction.status}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Daily Stats Tab */}
              {activeTab === 'stats' && (
                <div className="space-y-2">
                  {dailyStats.length === 0 ? (
                    <div className="text-center py-12">
                      <Activity className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                      <p className="text-gray-500">No statistics available</p>
                    </div>
                  ) : (
                    dailyStats.map((stat, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                      >
                        <div className="flex items-center">
                          <Calendar className="w-4 h-4 text-gray-400 mr-3" />
                          <span className="text-sm font-medium text-gray-900">
                            {stat._id}
                          </span>
                        </div>
                        <div className="flex items-center space-x-6">
                          <div className="text-right">
                            <p className="text-xs text-gray-500">Cycles</p>
                            <p className="font-semibold text-gray-900">{stat.cycles}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-gray-500">Revenue</p>
                            <p className="font-semibold text-primary-600">
                              {formatCurrency(stat.revenue)}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Maintenance Tab */}
              {activeTab === 'maintenance' && (
                <div className="space-y-2">
                  {maintenanceLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <RefreshCw className="w-6 h-6 text-gray-400 animate-spin" />
                    </div>
                  ) : maintenanceRecords.length === 0 ? (
                    <div className="text-center py-12">
                      <Wrench className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                      <p className="text-gray-500">No maintenance records</p>
                    </div>
                  ) : (
                    maintenanceRecords.map((record) => (
                      <div
                        key={record.id}
                        className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                      >
                        <div className="flex items-center">
                          <div
                            className={cn(
                              'p-2 rounded-lg mr-3',
                              record.type === 'preventive' && 'bg-primary-100 text-primary-600',
                              record.type === 'corrective' && 'bg-warning-100 text-warning-600',
                              record.type === 'emergency' && 'bg-danger-100 text-danger-600',
                              record.type === 'inspection' && 'bg-gray-100 text-gray-600'
                            )}
                          >
                            <Wrench className="w-4 h-4" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900">
                              {record.description}
                            </p>
                            <p className="text-xs text-gray-500">
                              {formatDate(new Date(record.createdAt))}
                              {record.performedBy && ` • ${record.performedBy}`}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-gray-900">
                            {formatCurrency(record.cost || 0)}
                          </p>
                          <span
                            className={cn(
                              'text-xs px-2 py-0.5 rounded-full',
                              record.status === 'completed' && 'bg-success-100 text-success-700',
                              record.status === 'scheduled' && 'bg-primary-100 text-primary-700',
                              record.status === 'in_progress' && 'bg-warning-100 text-warning-700'
                            )}
                          >
                            {record.status}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex justify-end pt-4 border-t border-gray-200">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
