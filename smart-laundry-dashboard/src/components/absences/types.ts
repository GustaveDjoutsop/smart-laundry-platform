import type { Absence, AbsenceType, AbsenceStatus, AbsenceSummary } from '@/lib/api';

export interface AbsenceTableProps {
  absences: Absence[];
  isLoading: boolean;
  showEmployee?: boolean;
  canApprove?: boolean;
  currentUserId?: string;
  onApprove?: (id: string, notes?: string) => Promise<void>;
  onReject?: (id: string, notes: string) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  onEdit?: (absence: Absence) => void;
}

export interface AbsenceFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    employeeId?: string;
    type: AbsenceType;
    startDate: string;
    endDate: string;
    reason?: string;
  }) => Promise<void>;
  employees?: Array<{ _id: string; name: string; email: string }>;
  canAssignToOthers?: boolean;
  editingAbsence?: Absence | null;
}

export interface AbsenceSummaryCardProps {
  summary: AbsenceSummary | null;
  isLoading: boolean;
  year: number;
}

export interface AbsenceActionsProps {
  absence: Absence;
  canApprove: boolean;
  isOwner: boolean;
  onApprove: (id: string, notes?: string) => Promise<void>;
  onReject: (id: string, notes: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onEdit: (absence: Absence) => void;
}

export type { Absence, AbsenceType, AbsenceStatus, AbsenceSummary };

// Absence type labels and colors
export const absenceTypeConfig: Record<
  AbsenceType,
  { label: string; color: string; bgColor: string }
> = {
  vacation: { label: 'Vacation', color: 'text-primary-700', bgColor: 'bg-primary-100' },
  sick: { label: 'Sick Leave', color: 'text-danger-700', bgColor: 'bg-danger-100' },
  personal: { label: 'Personal', color: 'text-purple-700', bgColor: 'bg-purple-100' },
  unpaid_leave: { label: 'Unpaid Leave', color: 'text-gray-700', bgColor: 'bg-gray-100' },
  family_emergency: { label: 'Family Emergency', color: 'text-warning-700', bgColor: 'bg-warning-100' },
  training: { label: 'Training', color: 'text-success-700', bgColor: 'bg-success-100' },
};

// Absence status labels and colors
export const absenceStatusConfig: Record<
  AbsenceStatus,
  { label: string; color: string; bgColor: string }
> = {
  pending: { label: 'Pending', color: 'text-warning-700', bgColor: 'bg-warning-100' },
  approved: { label: 'Approved', color: 'text-success-700', bgColor: 'bg-success-100' },
  rejected: { label: 'Rejected', color: 'text-danger-700', bgColor: 'bg-danger-100' },
};
