'use client';

import { cn } from '@/lib/utils';

type FilterType = 'all' | 'washer' | 'dryer';
type StatusFilter = 'all' | 'available' | 'in_use' | 'error' | 'maintenance';

interface MachineFiltersProps {
  typeFilter: FilterType;
  onTypeFilterChange: (filter: FilterType) => void;
  statusFilter?: StatusFilter;
  onStatusFilterChange?: (filter: StatusFilter) => void;
  showStatusFilter?: boolean;
}

const typeFilters: { value: FilterType; label: string }[] = [
  { value: 'all', label: 'All Machines' },
  { value: 'washer', label: 'Washers' },
  { value: 'dryer', label: 'Dryers' },
];

const statusFilters: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All Status' },
  { value: 'available', label: 'Available' },
  { value: 'in_use', label: 'In Use' },
  { value: 'error', label: 'Error' },
  { value: 'maintenance', label: 'Maintenance' },
];

export default function MachineFilters({
  typeFilter,
  onTypeFilterChange,
  statusFilter = 'all',
  onStatusFilterChange,
  showStatusFilter = false,
}: MachineFiltersProps) {
  return (
    <div className="flex flex-wrap gap-4 mb-6">
      {/* Type Filter */}
      <div className="flex space-x-2">
        {typeFilters.map((filter) => (
          <button
            key={filter.value}
            onClick={() => onTypeFilterChange(filter.value)}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              typeFilter === filter.value
                ? 'bg-primary-600 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {/* Status Filter */}
      {showStatusFilter && onStatusFilterChange && (
        <div className="flex space-x-2">
          {statusFilters.map((filter) => (
            <button
              key={filter.value}
              onClick={() => onStatusFilterChange(filter.value)}
              className={cn(
                'px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                statusFilter === filter.value
                  ? 'bg-gray-800 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
