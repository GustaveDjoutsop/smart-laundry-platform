export const styles = {
  // Table
  table: {
    container: 'card overflow-hidden',
    header: 'card-header flex items-center justify-between',
    title: 'card-title',
    tableContainer: 'overflow-x-auto',
    table: 'min-w-full divide-y divide-gray-200',
    thead: 'bg-gray-50',
    th: 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider',
    tbody: 'bg-white divide-y divide-gray-200',
    tr: 'hover:bg-gray-50',
    td: 'px-6 py-4 whitespace-nowrap text-sm',
    tdText: 'text-gray-900',
    tdSubtext: 'text-gray-500',
    badge: {
      base: 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
    },
    actionButton: 'p-1 rounded hover:bg-gray-100 transition-colors',
    emptyState: 'text-center py-12 text-gray-500',
    loadingState: 'animate-pulse bg-gray-200 rounded h-4',
  },

  // Form Modal
  modal: {
    overlay: 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50',
    container: 'bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto',
    header: 'flex items-center justify-between p-4 border-b sticky top-0 bg-white',
    title: 'text-lg font-semibold text-gray-900',
    closeButton: 'text-gray-400 hover:text-gray-500',
    body: 'p-4 space-y-4',
    footer: 'flex justify-end gap-3 p-4 border-t sticky bottom-0 bg-white',
    label: 'block text-sm font-medium text-gray-700 mb-1',
    required: 'text-danger-500',
    input: 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500',
    select: 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500',
    textarea: 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none',
    cancelButton: 'px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50',
    submitButton: 'px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50',
    dateRow: 'grid grid-cols-2 gap-4',
    error: 'p-3 bg-danger-50 border border-danger-200 rounded-lg text-sm text-danger-700',
  },

  // Summary Card
  summary: {
    container: 'card',
    header: 'card-header',
    title: 'card-title',
    body: 'p-6',
    grid: 'grid grid-cols-2 md:grid-cols-3 gap-4',
    statCard: 'p-4 rounded-lg text-center',
    statIcon: 'w-6 h-6 mx-auto mb-2',
    statLabel: 'text-xs text-gray-500 mb-1',
    statValue: 'text-xl font-bold',
    statCount: 'text-xs text-gray-400',
  },

  // Actions
  actions: {
    container: 'flex items-center gap-2',
    approveButton: 'text-success-600 hover:text-success-700',
    rejectButton: 'text-danger-600 hover:text-danger-700',
    editButton: 'text-gray-600 hover:text-gray-700',
    deleteButton: 'text-danger-600 hover:text-danger-700',
  },

  // Reject Modal
  rejectModal: {
    overlay: 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50',
    container: 'bg-white rounded-lg shadow-xl max-w-md w-full mx-4',
    header: 'p-4 border-b',
    title: 'text-lg font-semibold text-gray-900',
    body: 'p-4',
    footer: 'flex justify-end gap-3 p-4 border-t',
    cancelButton: 'px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50',
    rejectButton: 'px-4 py-2 text-sm font-medium text-white bg-danger-600 rounded-lg hover:bg-danger-700 disabled:opacity-50',
  },
} as const;
