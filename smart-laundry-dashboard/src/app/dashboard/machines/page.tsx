'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/ui/Header';
import { MachineCard, MachineFilters, MachineHistoryModal, MachineQRCodeModal } from '@/components/machines';
import { useMachinesWithPolling } from '@/hooks';
import { useAuth, hasPermission } from '@/lib/auth';
import { RefreshCw, WifiOff, WashingMachine } from 'lucide-react';
import type { MachineStatus } from '@/types';

export default function MachinesPage() {
  const router = useRouter();
  const { user } = useAuth();

  // Check if user has permission to access maintenance and QR codes
  const canAccessMaintenance = user ? hasPermission(user, 'machines:maintenance') : false;
  // QR codes available to all users who can read machines (admin, owner, manager, employee)
  const canAccessQRCodes = user ? hasPermission(user, 'machines:read') : false;

  const [typeFilter, setTypeFilter] = useState<'all' | 'washer' | 'dryer'>('all');
  const [selectedMachine, setSelectedMachine] = useState<MachineStatus | null>(null);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isQRCodeModalOpen, setIsQRCodeModalOpen] = useState(false);

  // Fetch machines from API with polling every 30 seconds for real-time updates
  const {
    data: machinesData,
    loading,
    error,
    refetch,
  } = useMachinesWithPolling(30000);

  const machines = machinesData?.machines || [];

  const filteredMachines = machines.filter((m) => {
    if (typeFilter === 'all') return true;
    return m.type === typeFilter;
  });

  const handleViewHistory = (machineId: string) => {
    const machine = machines.find((m) => m.id === machineId);
    if (machine) {
      setSelectedMachine(machine);
      setIsHistoryModalOpen(true);
    }
  };

  const handleMaintenance = (machineId: string) => {
    // Navigate to maintenance page with the machine pre-selected
    router.push(`/dashboard/maintenance?machine=${machineId}`);
  };

  const handleShowQRCode = (machineId: string) => {
    const machine = machines.find((m) => m.id === machineId);
    if (machine) {
      setSelectedMachine(machine);
      setIsQRCodeModalOpen(true);
    }
  };

  // Calculate summary stats
  const availableCount = machines.filter((m) => m.status === 'available').length;
  const inUseCount = machines.filter((m) => m.status === 'in_use').length;
  const errorCount = machines.filter((m) => m.status === 'error').length;
  const washerCount = machines.filter((m) => m.type === 'washer').length;
  const dryerCount = machines.filter((m) => m.type === 'dryer').length;

  if (loading && machines.length === 0) {
    return (
      <>
        <Header title="Machines" />
        <main className="flex-1 overflow-y-auto p-6">
          <div className="animate-pulse space-y-6">
            <div className="h-12 bg-gray-200 rounded-lg w-64" />
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="h-64 bg-gray-200 rounded-lg" />
              ))}
            </div>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Header title="Machines" />
      <main className="flex-1 overflow-y-auto p-6">
        {/* Connection Status Banner */}
        {error && (
          <div className="mb-4 p-3 bg-warning-50 border border-warning-200 rounded-lg flex items-center justify-between">
            <div className="flex items-center text-warning-700">
              <WifiOff className="w-5 h-5 mr-2" />
              <span className="text-sm">Unable to connect to backend. Data may be outdated.</span>
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

        {/* Status Summary */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <p className="text-sm text-gray-500">Total Machines</p>
            <p className="text-2xl font-bold text-gray-900">{machines.length}</p>
            <p className="text-xs text-gray-500 mt-1">
              {washerCount} washers, {dryerCount} dryers
            </p>
          </div>
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <p className="text-sm text-gray-500">Available</p>
            <p className="text-2xl font-bold text-success-600">{availableCount}</p>
            <div className="w-full h-1.5 bg-gray-200 rounded-full mt-2">
              <div
                className="h-full bg-success-500 rounded-full"
                style={{ width: `${machines.length > 0 ? (availableCount / machines.length) * 100 : 0}%` }}
              />
            </div>
          </div>
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <p className="text-sm text-gray-500">In Use</p>
            <p className="text-2xl font-bold text-primary-600">{inUseCount}</p>
            <div className="w-full h-1.5 bg-gray-200 rounded-full mt-2">
              <div
                className="h-full bg-primary-500 rounded-full"
                style={{ width: `${machines.length > 0 ? (inUseCount / machines.length) * 100 : 0}%` }}
              />
            </div>
          </div>
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <p className="text-sm text-gray-500">Errors</p>
            <p className="text-2xl font-bold text-danger-600">{errorCount}</p>
            <div className="w-full h-1.5 bg-gray-200 rounded-full mt-2">
              <div
                className="h-full bg-danger-500 rounded-full"
                style={{ width: `${machines.length > 0 ? (errorCount / machines.length) * 100 : 0}%` }}
              />
            </div>
          </div>
          <div className="bg-white rounded-lg p-4 border border-gray-200 flex items-center justify-center">
            <button
              onClick={() => refetch()}
              className="flex items-center text-primary-600 hover:text-primary-700"
            >
              <RefreshCw className={`w-5 h-5 mr-2 ${loading ? 'animate-spin' : ''}`} />
              <span className="text-sm font-medium">Refresh</span>
            </button>
          </div>
        </div>

        <MachineFilters
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
        />

        {/* Machine Cards */}
        {filteredMachines.length === 0 ? (
          <div className="text-center py-12">
            <WashingMachine className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900">No Machines Found</h3>
            <p className="text-gray-500">
              {typeFilter === 'all'
                ? 'No machines are registered in the system.'
                : `No ${typeFilter}s found.`}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredMachines.map((machine) => (
              <MachineCard
                key={machine.id}
                machine={machine}
                onViewHistory={handleViewHistory}
                onMaintenance={handleMaintenance}
                onShowQRCode={handleShowQRCode}
                showMaintenanceButton={canAccessMaintenance}
                showQRCodeButton={canAccessQRCodes}
              />
            ))}
          </div>
        )}
      </main>

      {/* Machine History Modal */}
      <MachineHistoryModal
        isOpen={isHistoryModalOpen}
        onClose={() => setIsHistoryModalOpen(false)}
        machine={selectedMachine}
      />

      {/* Machine QR Code Modal */}
      <MachineQRCodeModal
        isOpen={isQRCodeModalOpen}
        onClose={() => setIsQRCodeModalOpen(false)}
        machine={selectedMachine}
      />
    </>
  );
}
