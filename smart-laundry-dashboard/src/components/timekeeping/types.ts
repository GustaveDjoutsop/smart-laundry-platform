import type { TimeEntry, ClockStatus, TimeEntrySummary } from '@/lib/api';

export interface TimeClockCardProps {
  status: ClockStatus | null;
  isLoading: boolean;
  onClockIn: () => Promise<void>;
  onClockOut: () => Promise<void>;
}

export interface TimeEntryTableProps {
  entries: TimeEntry[];
  isLoading: boolean;
  showEmployee?: boolean;
  canManage?: boolean;
  onDelete?: (id: string) => Promise<void>;
}

export interface TimeEntrySummaryProps {
  summary: TimeEntrySummary | null;
  isLoading: boolean;
}

export interface ManualEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    employeeId: string;
    type: 'clock_in' | 'clock_out';
    timestamp: string;
    notes?: string;
  }) => Promise<void>;
  employees: Array<{ _id: string; name: string; email: string }>;
}

export type { TimeEntry, ClockStatus, TimeEntrySummary };
