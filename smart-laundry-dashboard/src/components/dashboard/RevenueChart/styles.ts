export const styles = {
  // Container
  container: 'card',
  header: 'card-header',
  title: 'card-title',
  targetText: 'text-sm text-gray-500',

  // Progress bar
  progressWrapper: 'mb-4',
  progressBar: 'h-2 bg-gray-200 rounded-full overflow-hidden',
  progressFill: 'h-full bg-primary-500 rounded-full transition-all duration-500',
  progressLabel: 'text-xs text-gray-500 mt-1',

  // Chart
  chartContainer: 'h-64',

  // Daily breakdown
  dailyGrid: 'grid grid-cols-7 gap-2 mt-4',
  dailyItem: 'text-center',
  dailyLabel: 'text-xs text-gray-500',
  dailyValue: 'text-sm font-medium text-gray-900',
} as const;

// Chart colors
export const chartColors = {
  stroke: '#3b82f6',
  gradientStart: '#3b82f6',
  gradientStartOpacity: 0.3,
  gradientEndOpacity: 0,
  grid: '#e5e7eb',
  tick: '#6b7280',
} as const;

// Tooltip styles
export const tooltipStyles = {
  backgroundColor: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
} as const;
