import type { TransactionStatus } from './types';

export const styles = {
  // Container
  container: 'card',
  header: 'card-header',
  title: 'card-title',
  viewAllLink: 'text-sm text-primary-600 hover:text-primary-700',

  // List
  list: 'space-y-3',
  emptyState: 'text-sm text-gray-500 text-center py-4',

  // Transaction Item
  item: {
    container: 'flex items-center justify-between p-3 bg-gray-50 rounded-lg',
    content: 'flex-1',
    nameRow: 'flex items-center space-x-2',
    machineName: 'text-sm font-medium text-gray-900',
    detailsRow: 'flex items-center space-x-2 mt-1',
    program: 'text-xs text-gray-500',
    separator: 'text-xs text-gray-400',
    time: 'text-xs text-gray-500',
    rightColumn: 'text-right',
    amount: 'text-sm font-semibold text-gray-900',
    status: 'text-xs',
  },

  // Badge
  badge: 'badge',
} as const;

// Provider color mapping
export const providerColors: Record<string, string> = {
  campay: 'bg-blue-100 text-blue-700',
  mtn: 'bg-yellow-100 text-yellow-700',
  orange: 'bg-orange-100 text-orange-700',
  wave: 'bg-cyan-100 text-cyan-700',
  nkwa: 'bg-purple-100 text-purple-700',
};

// Status color mapping
export const statusColors: Record<TransactionStatus, string> = {
  completed: 'text-success-600',
  pending: 'text-warning-600',
  failed: 'text-danger-600',
};
