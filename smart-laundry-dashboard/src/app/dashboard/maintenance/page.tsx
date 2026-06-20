'use client';

import { useState } from 'react';
import Header from '@/components/ui/Header';
import {
  Wrench,
  AlertTriangle,
  CheckCircle,
  Clock,
  Calendar,
  Plus,
  WashingMachine,
  Wind,
  RefreshCw,
  WifiOff,
} from 'lucide-react';
import { formatCurrency, formatDate, cn, getSeverityColor } from '@/lib/utils';
import { useMaintenanceAlerts, useMaintenanceHistory, useMachines } from '@/hooks';
import { MaintenanceModal } from '@/components/maintenance';
import type { MachineStatus, MaintenanceAlert } from '@/types';

type TabType = 'alerts' | 'schedule' | 'history';

export default function MaintenancePage() {
  const [activeTab, setActiveTab] = useState<TabType>('alerts');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'schedule' | 'log'>('log');
  const [selectedMachine, setSelectedMachine] = useState<MachineStatus | null>(null);

  // Fetch data from API
  const {
    data: alertsData,
    loading: alertsLoading,
    error: alertsError,
    refetch: refetchAlerts,
  } = useMaintenanceAlerts();
  const {
    data: historyData,
    loading: historyLoading,
    error: historyError,
    refetch: refetchHistory,
  } = useMaintenanceHistory({ limit: 20 });
  const {
    data: machinesData,
    loading: machinesLoading,
    error: machinesError,
    refetch: refetchMachines,
  } = useMachines();

  const isLoading = alertsLoading || historyLoading || machinesLoading;
  const hasError = alertsError || historyError || machinesError;

  const alerts = alertsData?.alerts || [];
  const maintenanceRecords = historyData?.maintenance || [];
  const machines = machinesData?.machines || [];

  // Calculate stats
  const totalMaintenanceCost = maintenanceRecords.reduce((sum, r) => sum + (r.cost || 0), 0);
  const machinesNeedingAttention = machines.filter(
    (m) => m.cyclesSinceMaintenance > 300 || m.errorCount >= 2
  ).length;
  const completedThisMonth = maintenanceRecords.filter((r) => {
    const recordDate = new Date(r.createdAt);
    const now = new Date();
    return (
      recordDate.getMonth() === now.getMonth() &&
      recordDate.getFullYear() === now.getFullYear()
    );
  }).length;

  const handleOpenModal = (mode: 'schedule' | 'log', machine?: MachineStatus) => {
    setModalMode(mode);
    setSelectedMachine(machine || null);
    setIsModalOpen(true);
  };

  const handleModalSuccess = () => {
    refetchAlerts();
    refetchHistory();
    refetchMachines();
  };

  const handleRefresh = () => {
    refetchAlerts();
    refetchHistory();
    refetchMachines();
  };

  // Generate alerts from machines if API alerts are empty
  const displayAlerts: MaintenanceAlert[] =
    alerts.length > 0
      ? alerts
      : machines
          .filter((m) => m.cyclesSinceMaintenance > 300 || m.errorCount >= 2)
          .map((m) => ({
            id: `alert-${m.id}`,
            machineId: m.id,
            type: m.errorCount >= 2 ? 'corrective' : 'preventive',
            status: 'scheduled',
            priority: m.cyclesSinceMaintenance > 400 ? 'high' : 'medium',
            description:
              m.cyclesSinceMaintenance > 400
                ? `${m.cyclesSinceMaintenance} cycles since last maintenance - immediate attention required`
                : m.errorCount >= 2
                ? `${m.errorCount} errors recorded - investigate recurring issues`
                : `${m.cyclesSinceMaintenance} cycles since last maintenance - schedule soon`,
            isAlert: true,
            alertAcknowledged: false,
            createdAt: new Date(),
          })) as MaintenanceAlert[];

  if (isLoading) {
    return (
      <>
        <Header title="Maintenance" />
        <main className="flex-1 overflow-y-auto p-6">
          <div className="animate-pulse space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-24 bg-gray-200 rounded-lg" />
              ))}
            </div>
            <div className="h-12 bg-gray-200 rounded-lg w-64" />
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-32 bg-gray-200 rounded-lg" />
              ))}
            </div>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Header title="Maintenance" />
      <main className="flex-1 overflow-y-auto p-6">
        {/* Connection Status Banner */}
        {hasError && (
          <div className="mb-4 p-3 bg-warning-50 border border-warning-200 rounded-lg flex items-center justify-between">
            <div className="flex items-center text-warning-700">
              <WifiOff className="w-5 h-5 mr-2" />
              <span className="text-sm">
                Unable to connect to backend. Showing cached/mock data.
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

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="card">
            <div className="flex items-center">
              <div className="p-3 rounded-lg bg-danger-50 text-danger-600 mr-4">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Active Alerts</p>
                <p className="text-2xl font-bold text-gray-900">{displayAlerts.length}</p>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="flex items-center">
              <div className="p-3 rounded-lg bg-warning-50 text-warning-600 mr-4">
                <Wrench className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Need Attention</p>
                <p className="text-2xl font-bold text-gray-900">{machinesNeedingAttention}</p>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="flex items-center">
              <div className="p-3 rounded-lg bg-success-50 text-success-600 mr-4">
                <CheckCircle className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Completed This Month</p>
                <p className="text-2xl font-bold text-gray-900">{completedThisMonth}</p>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="flex items-center">
              <div className="p-3 rounded-lg bg-primary-50 text-primary-600 mr-4">
                <Calendar className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Maintenance Cost</p>
                <p className="text-2xl font-bold text-gray-900">
                  {formatCurrency(totalMaintenanceCost)}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex space-x-2 mb-6">
          {(['alerts', 'schedule', 'history'] as TabType[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                activeTab === tab
                  ? 'bg-primary-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              )}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
              {tab === 'alerts' && displayAlerts.length > 0 && (
                <span className="ml-2 px-2 py-0.5 bg-danger-500 text-white text-xs rounded-full">
                  {displayAlerts.length}
                </span>
              )}
            </button>
          ))}
          <div className="flex-1" />
          <button
            onClick={() => handleOpenModal('log')}
            className="btn btn-primary"
          >
            <Plus className="w-4 h-4 mr-2" />
            Log Maintenance
          </button>
        </div>

        {/* Alerts Tab */}
        {activeTab === 'alerts' && (
          <div className="space-y-4">
            {displayAlerts.length === 0 ? (
              <div className="card text-center py-12">
                <CheckCircle className="w-12 h-12 text-success-500 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900">All Clear!</h3>
                <p className="text-gray-500">No maintenance alerts at this time.</p>
              </div>
            ) : (
              displayAlerts.map((alert) => {
                const machine = machines.find((m) => m.id === alert.machineId);
                return (
                  <div key={alert.id} className="card">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start">
                        {machine?.type === 'washer' ? (
                          <WashingMachine className="w-8 h-8 text-primary-600 mr-4 mt-1" />
                        ) : (
                          <Wind className="w-8 h-8 text-warning-500 mr-4 mt-1" />
                        )}
                        <div>
                          <div className="flex items-center space-x-2">
                            <h3 className="font-semibold text-gray-900">
                              {machine?.name || alert.machineId}
                            </h3>
                            <span
                              className={cn(
                                'badge',
                                getSeverityColor(alert.priority)
                              )}
                            >
                              {alert.priority.toUpperCase()}
                            </span>
                          </div>
                          <p className="text-gray-600 mt-1">{alert.description}</p>
                          {machine && (
                            <div className="flex items-center space-x-4 mt-2 text-sm text-gray-500">
                              <span>{machine.cyclesSinceMaintenance} cycles</span>
                              <span>
                                ~
                                {Math.floor(
                                  machine.cyclesSinceMaintenance / machine.averageCyclesPerDay
                                )}{' '}
                                days
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => handleOpenModal('schedule', machine || undefined)}
                        className="btn btn-primary text-sm"
                      >
                        Schedule Maintenance
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Schedule Tab */}
        {activeTab === 'schedule' && (
          <div className="card">
            <h3 className="card-title mb-4">Machine Maintenance Schedule</h3>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Machine
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Type
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Cycles Since Maint.
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Health
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {machines.map((machine) => {
                    const healthStatus =
                      machine.cyclesSinceMaintenance > 400
                        ? 'critical'
                        : machine.cyclesSinceMaintenance > 300
                        ? 'warning'
                        : 'good';
                    return (
                      <tr key={machine.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="flex items-center">
                            {machine.type === 'washer' ? (
                              <WashingMachine className="w-5 h-5 text-primary-600 mr-2" />
                            ) : (
                              <Wind className="w-5 h-5 text-warning-500 mr-2" />
                            )}
                            <span className="font-medium text-gray-900">{machine.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500 capitalize">
                          {machine.type}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              'badge',
                              machine.status === 'available' && 'badge-success',
                              machine.status === 'in_use' && 'badge-primary',
                              machine.status === 'error' && 'badge-danger'
                            )}
                          >
                            {machine.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900">
                          {machine.cyclesSinceMaintenance}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center">
                            <div
                              className={cn(
                                'w-2 h-2 rounded-full mr-2',
                                healthStatus === 'good' && 'bg-success-500',
                                healthStatus === 'warning' && 'bg-warning-500',
                                healthStatus === 'critical' && 'bg-danger-500'
                              )}
                            />
                            <span
                              className={cn(
                                'text-sm capitalize',
                                healthStatus === 'good' && 'text-success-600',
                                healthStatus === 'warning' && 'text-warning-600',
                                healthStatus === 'critical' && 'text-danger-600'
                              )}
                            >
                              {healthStatus}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => handleOpenModal('schedule', machine)}
                            className="text-primary-600 hover:text-primary-700 text-sm font-medium"
                          >
                            Schedule
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          <div className="card">
            <h3 className="card-title mb-4">Maintenance History</h3>
            {maintenanceRecords.length === 0 ? (
              <div className="text-center py-12">
                <Clock className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900">No Records Yet</h3>
                <p className="text-gray-500">Maintenance history will appear here.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {maintenanceRecords.map((record) => {
                  const machine = machines.find((m) => m.id === record.machineId);
                  return (
                    <div
                      key={record.id}
                      className="flex items-start p-4 bg-gray-50 rounded-lg"
                    >
                      <div
                        className={cn(
                          'p-2 rounded-lg mr-4',
                          record.type === 'preventive' && 'bg-primary-100 text-primary-600',
                          record.type === 'corrective' && 'bg-warning-100 text-warning-600',
                          record.type === 'emergency' && 'bg-danger-100 text-danger-600',
                          record.type === 'inspection' && 'bg-gray-100 text-gray-600'
                        )}
                      >
                        <Wrench className="w-5 h-5" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <span className="font-semibold text-gray-900">
                              {machine?.name || record.machineId}
                            </span>
                            <span
                              className={cn(
                                'badge text-xs',
                                record.type === 'preventive' &&
                                  'bg-primary-100 text-primary-700',
                                record.type === 'corrective' &&
                                  'bg-warning-100 text-warning-700',
                                record.type === 'emergency' && 'bg-danger-100 text-danger-700',
                                record.type === 'inspection' && 'bg-gray-100 text-gray-700'
                              )}
                            >
                              {record.type}
                            </span>
                            <span
                              className={cn(
                                'badge text-xs',
                                record.status === 'completed' &&
                                  'bg-success-100 text-success-700',
                                record.status === 'scheduled' &&
                                  'bg-primary-100 text-primary-700',
                                record.status === 'in_progress' &&
                                  'bg-warning-100 text-warning-700',
                                record.status === 'cancelled' && 'bg-gray-100 text-gray-700'
                              )}
                            >
                              {record.status}
                            </span>
                          </div>
                          <span className="font-semibold text-gray-900">
                            {formatCurrency(record.cost || 0)}
                          </span>
                        </div>
                        <p className="text-gray-600 mt-1">{record.description}</p>
                        <div className="flex items-center space-x-4 mt-2 text-sm text-gray-500">
                          <span>{formatDate(new Date(record.createdAt))}</span>
                          {record.performedBy && (
                            <span>Technician: {record.performedBy}</span>
                          )}
                          {record.partsReplaced && record.partsReplaced.length > 0 && (
                            <span>
                              Parts: {record.partsReplaced.map((p) => p.name).join(', ')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Maintenance Modal */}
      <MaintenanceModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={handleModalSuccess}
        machine={selectedMachine}
        machines={machines}
        mode={modalMode}
      />
    </>
  );
}
