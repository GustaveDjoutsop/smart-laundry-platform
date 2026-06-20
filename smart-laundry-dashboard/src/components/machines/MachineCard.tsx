'use client';

import { WashingMachine, Wind, Settings, AlertCircle, CheckCircle, Clock, QrCode } from 'lucide-react';
import { cn, formatTime } from '@/lib/utils';
import type { MachineStatus, MachineStatusType } from '@/types';

interface MachineCardProps {
  machine: MachineStatus;
  onViewHistory?: (machineId: string) => void;
  onMaintenance?: (machineId: string) => void;
  onShowQRCode?: (machineId: string) => void;
  showMaintenanceButton?: boolean;
  showQRCodeButton?: boolean;
}

const statusConfig: Record<MachineStatusType, { label: string; color: string; icon: typeof CheckCircle }> = {
  available: { label: 'Available', color: 'bg-success-500', icon: CheckCircle },
  in_use: { label: 'In Use', color: 'bg-primary-500', icon: Clock },
  completing: { label: 'Completing', color: 'bg-warning-500', icon: Clock },
  error: { label: 'Error', color: 'bg-danger-500', icon: AlertCircle },
  maintenance: { label: 'Maintenance', color: 'bg-warning-500', icon: Settings },
  offline: { label: 'Offline', color: 'bg-gray-400', icon: AlertCircle },
  reserved: { label: 'Reserved', color: 'bg-purple-500', icon: Clock },
};

// Default fallback for unknown status
const defaultStatus = { label: 'Unknown', color: 'bg-gray-400', icon: AlertCircle };

export default function MachineCard({
  machine,
  onViewHistory,
  onMaintenance,
  onShowQRCode,
  showMaintenanceButton = true,
  showQRCodeButton = false,
}: MachineCardProps) {
  // Use fallback if status is not in config (handles unknown statuses from backend)
  const status = statusConfig[machine.status] || defaultStatus;
  const StatusIcon = status.icon;

  // Calculate progress for in-use machines (assuming 45 min max cycle)
  const maxCycleTime = 45;
  const progress = machine.timeRemaining
    ? ((maxCycleTime - machine.timeRemaining) / maxCycleTime) * 100
    : 0;

  return (
    <div className="card">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center">
          {machine.type === 'washer' ? (
            <WashingMachine className="w-8 h-8 text-primary-600 mr-3" />
          ) : (
            <Wind className="w-8 h-8 text-warning-500 mr-3" />
          )}
          <div>
            <h3 className="font-semibold text-gray-900">{machine.name}</h3>
            <p className="text-sm text-gray-500 capitalize">{machine.type}</p>
          </div>
        </div>
        <div
          className={cn(
            'flex items-center px-2 py-1 rounded-full text-xs font-medium text-white',
            status.color
          )}
        >
          <StatusIcon className="w-3 h-3 mr-1" />
          {status.label}
        </div>
      </div>

      {/* In Use Status */}
      {machine.status === 'in_use' && machine.timeRemaining && (
        <div className="bg-primary-50 rounded-lg p-3 mb-4">
          <p className="text-sm text-primary-700">
            <span className="font-medium">{machine.currentProgram}</span> -{' '}
            {formatTime(machine.timeRemaining)} remaining
          </p>
          <div className="mt-2 h-2 bg-primary-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary-500 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Completing Status */}
      {machine.status === 'completing' && (
        <div className="bg-warning-50 rounded-lg p-3 mb-4">
          <p className="text-sm text-warning-700 font-medium">
            Cycle complete - Ready for pickup
          </p>
        </div>
      )}

      {/* Error Status */}
      {machine.status === 'error' && machine.lastError && (
        <div className="bg-danger-50 rounded-lg p-3 mb-4">
          <p className="text-sm text-danger-700">
            <span className="font-medium">Error {machine.lastError.code}:</span>{' '}
            {machine.lastError.message}
          </p>
        </div>
      )}

      {/* Maintenance Status */}
      {machine.status === 'maintenance' && (
        <div className="bg-warning-50 rounded-lg p-3 mb-4">
          <p className="text-sm text-warning-700 font-medium">
            Under maintenance
          </p>
        </div>
      )}

      {/* Offline Status */}
      {machine.status === 'offline' && (
        <div className="bg-gray-100 rounded-lg p-3 mb-4">
          <p className="text-sm text-gray-600 font-medium">
            Machine is offline
          </p>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-gray-500">Total Cycles</p>
          <p className="font-semibold text-gray-900">
            {(machine.totalCycles ?? 0).toLocaleString()}
          </p>
        </div>
        <div>
          <p className="text-gray-500">This Month</p>
          <p className="font-semibold text-gray-900">{machine.cyclesThisMonth ?? 0}</p>
        </div>
        <div>
          <p className="text-gray-500">Utilization</p>
          <p className="font-semibold text-gray-900">{machine.utilizationRate ?? 0}%</p>
        </div>
        <div>
          <p className="text-gray-500">Since Maintenance</p>
          <p
            className={cn(
              'font-semibold',
              (machine.cyclesSinceMaintenance ?? 0) > 400
                ? 'text-danger-600'
                : (machine.cyclesSinceMaintenance ?? 0) > 300
                ? 'text-warning-600'
                : 'text-gray-900'
            )}
          >
            {machine.cyclesSinceMaintenance ?? 0} cycles
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex space-x-2 mt-4 pt-4 border-t border-gray-200">
        <button
          className="btn btn-secondary flex-1 text-sm"
          onClick={() => onViewHistory?.(machine.id)}
        >
          View History
        </button>
        {showQRCodeButton && (
          <button
            className="btn btn-secondary flex-1 text-sm flex items-center justify-center"
            onClick={() => onShowQRCode?.(machine.id)}
            title="Show QR Code"
          >
            <QrCode className="w-4 h-4 mr-1" />
            QR Code
          </button>
        )}
        {showMaintenanceButton && (
          <button
            className="btn btn-secondary flex-1 text-sm"
            onClick={() => onMaintenance?.(machine.id)}
          >
            Maintenance
          </button>
        )}
      </div>
    </div>
  );
}
