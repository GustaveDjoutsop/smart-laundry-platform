import type { LucideIcon } from 'lucide-react';
import type { MachineStatus } from '@/types';

export interface MachineStatusGridProps {
  machines: MachineStatus[];
}

export interface MachineCardProps {
  machine: MachineStatus;
}

export type MachineStatusType = 'available' | 'in_use' | 'completing' | 'error' | 'maintenance' | 'offline';

export interface StatusConfig {
  icon: LucideIcon;
  label: string;
  borderColor: string;
  bgColor: string;
  iconColor: string;
}
