import type { LucideIcon } from 'lucide-react';
import { UserRole } from '@/lib/auth';

// Tab configuration
export type SettingsTab = 'business' | 'machines' | 'notifications' | 'payments' | 'users' | 'security';

export interface TabConfig {
  id: SettingsTab;
  label: string;
  icon: LucideIcon;
  // Roles that can see this tab (empty = all roles)
  allowedRoles?: UserRole[];
  // Roles that can edit content in this tab (empty = all roles that can see it)
  editableRoles?: UserRole[];
}

// Payment provider configuration
export interface PaymentProvider {
  name: string;
  enabled: boolean;
  color: string;
}

// Team member configuration
export interface TeamMember {
  name: string;
  email: string;
  role: string;
}

// Notification setting configuration
export interface NotificationSetting {
  label: string;
  desc: string;
  default: boolean;
}

// Program pricing configuration
export interface ProgramPricing {
  name: string;
  price: number;
}
