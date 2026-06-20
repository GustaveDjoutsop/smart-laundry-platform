import type { MachineStatusType } from './types';

export const styles = {
  // Container
  container: 'card',
  header: 'card-header',
  title: 'card-title',
  activeCount: 'text-sm text-gray-500',

  // Section
  section: 'mb-6',
  sectionLast: '',
  sectionHeader: 'flex items-center mb-3',
  sectionIcon: 'w-5 h-5 mr-2',
  sectionIconWasher: 'text-primary-600',
  sectionIconDryer: 'text-warning-500',
  sectionLabel: 'text-sm font-medium text-gray-700',

  // Grid
  gridWashers: 'grid grid-cols-3 gap-3',
  gridDryers: 'grid grid-cols-2 gap-3',

  // Machine Card
  card: {
    base: 'relative p-3 rounded-lg border-2 transition-colors',
    header: 'flex items-center justify-between mb-1',
    name: 'text-sm font-medium text-gray-900',
    statusIcon: 'w-4 h-4',
    details: 'text-xs text-gray-600',
    program: 'mt-1 text-xs text-gray-500',
    errorText: 'text-danger-600',
  },
} as const;

// Status-based styles
export const statusStyles: Record<MachineStatusType, {
  border: string;
  bg: string;
  icon: string;
}> = {
  available: {
    border: 'border-success-500',
    bg: 'bg-success-50',
    icon: 'text-success-600',
  },
  in_use: {
    border: 'border-primary-500',
    bg: 'bg-primary-50',
    icon: 'text-primary-600',
  },
  completing: {
    border: 'border-warning-500',
    bg: 'bg-warning-50',
    icon: 'text-warning-600',
  },
  error: {
    border: 'border-danger-500',
    bg: 'bg-danger-50',
    icon: 'text-danger-600',
  },
  maintenance: {
    border: 'border-warning-500',
    bg: 'bg-warning-50',
    icon: 'text-warning-600',
  },
  offline: {
    border: 'border-gray-300',
    bg: 'bg-gray-50',
    icon: 'text-gray-400',
  },
};

// Status labels
export const statusLabels: Record<MachineStatusType, string> = {
  available: 'Available',
  in_use: 'In Use',
  completing: 'Completing',
  error: 'Error',
  maintenance: 'Maintenance',
  offline: 'Offline',
};
