'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { maintenanceApi } from '@/lib/api';
import { WashingMachine, Wind, AlertCircle } from 'lucide-react';
import { cn, getErrorMessage } from '@/lib/utils';
import type { MachineStatus, MaintenanceType, MaintenancePriority } from '@/types';

interface MaintenanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  machine?: MachineStatus | null;
  machines?: MachineStatus[];
  mode: 'schedule' | 'log';
}

const maintenanceTypes: { value: MaintenanceType; label: string; description: string }[] = [
  { value: 'preventive', label: 'Preventive', description: 'Regular scheduled maintenance' },
  { value: 'corrective', label: 'Corrective', description: 'Fix an identified issue' },
  { value: 'emergency', label: 'Emergency', description: 'Urgent repair needed' },
  { value: 'inspection', label: 'Inspection', description: 'Routine inspection check' },
];

const priorities: { value: MaintenancePriority; label: string; color: string }[] = [
  { value: 'low', label: 'Low', color: 'bg-gray-100 text-gray-700 border-gray-300' },
  { value: 'medium', label: 'Medium', color: 'bg-warning-50 text-warning-700 border-warning-300' },
  { value: 'high', label: 'High', color: 'bg-danger-50 text-danger-700 border-danger-300' },
  { value: 'critical', label: 'Critical', color: 'bg-danger-100 text-danger-800 border-danger-500' },
];

export function MaintenanceModal({
  isOpen,
  onClose,
  onSuccess,
  machine,
  machines = [],
  mode,
}: MaintenanceModalProps) {
  const [selectedMachineId, setSelectedMachineId] = useState(machine?.id || '');
  const [type, setType] = useState<MaintenanceType>('preventive');
  const [priority, setPriority] = useState<MaintenancePriority>('medium');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [cost, setCost] = useState('');
  const [performedBy, setPerformedBy] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!selectedMachineId) {
      setError('Please select a machine');
      return;
    }

    if (!description.trim()) {
      setError('Please enter a description');
      return;
    }

    setIsSubmitting(true);

    try {
      await maintenanceApi.createLog({
        machineId: selectedMachineId,
        type,
        priority,
        description: description.trim(),
        notes: notes.trim() || undefined,
        cost: cost ? parseFloat(cost) : undefined,
        performedBy: performedBy.trim() || undefined,
      });

      // Reset form
      setSelectedMachineId('');
      setType('preventive');
      setPriority('medium');
      setDescription('');
      setNotes('');
      setCost('');
      setPerformedBy('');

      onSuccess();
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to create maintenance record.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setError(null);
      onClose();
    }
  };

  const selectedMachine = machine || machines.find((m) => m.id === selectedMachineId);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={mode === 'schedule' ? 'Schedule Maintenance' : 'Log Maintenance'}
      description={
        mode === 'schedule'
          ? 'Schedule maintenance for a machine'
          : 'Record completed maintenance work'
      }
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Error Alert */}
        {error && (
          <div className="p-3 rounded-lg bg-danger-50 border border-danger-200 flex items-start">
            <AlertCircle className="w-5 h-5 text-danger-600 mt-0.5 mr-2 flex-shrink-0" />
            <p className="text-sm text-danger-700">{error}</p>
          </div>
        )}

        {/* Machine Selection */}
        {!machine && machines.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select Machine
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto">
              {machines.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSelectedMachineId(m.id)}
                  className={cn(
                    'flex items-center p-3 rounded-lg border-2 transition-colors text-left',
                    selectedMachineId === m.id
                      ? 'border-primary-500 bg-primary-50'
                      : 'border-gray-200 hover:border-gray-300'
                  )}
                >
                  {m.type === 'washer' ? (
                    <WashingMachine className="w-5 h-5 text-primary-600 mr-2" />
                  ) : (
                    <Wind className="w-5 h-5 text-warning-500 mr-2" />
                  )}
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{m.name}</p>
                    <p className="text-xs text-gray-500 capitalize">{m.type}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Selected Machine Info */}
        {selectedMachine && (
          <div className="p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center">
              {selectedMachine.type === 'washer' ? (
                <WashingMachine className="w-8 h-8 text-primary-600 mr-3" />
              ) : (
                <Wind className="w-8 h-8 text-warning-500 mr-3" />
              )}
              <div>
                <p className="font-semibold text-gray-900">{selectedMachine.name}</p>
                <p className="text-sm text-gray-500">
                  {selectedMachine.cyclesSinceMaintenance} cycles since last maintenance
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Maintenance Type */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Maintenance Type
          </label>
          <div className="grid grid-cols-2 gap-2">
            {maintenanceTypes.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setType(t.value)}
                className={cn(
                  'p-3 rounded-lg border-2 text-left transition-colors',
                  type === t.value
                    ? 'border-primary-500 bg-primary-50'
                    : 'border-gray-200 hover:border-gray-300'
                )}
              >
                <p className="font-medium text-gray-900 text-sm">{t.label}</p>
                <p className="text-xs text-gray-500">{t.description}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Priority */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Priority
          </label>
          <div className="flex space-x-2">
            {priorities.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPriority(p.value)}
                className={cn(
                  'flex-1 py-2 px-3 rounded-lg border-2 text-sm font-medium transition-colors',
                  priority === p.value
                    ? p.color + ' border-current'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Description */}
        <div>
          <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
            Description *
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            placeholder="Describe the maintenance work..."
            required
          />
        </div>

        {/* Additional Notes */}
        <div>
          <label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-1">
            Additional Notes
          </label>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            placeholder="Any additional notes or observations..."
          />
        </div>

        {/* Cost and Technician */}
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Cost (XAF)"
            type="number"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder="0"
            min="0"
          />
          <Input
            label="Performed By"
            value={performedBy}
            onChange={(e) => setPerformedBy(e.target.value)}
            placeholder="Technician name"
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
          <Button
            type="button"
            variant="secondary"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" isLoading={isSubmitting}>
            {mode === 'schedule' ? 'Schedule Maintenance' : 'Log Maintenance'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
