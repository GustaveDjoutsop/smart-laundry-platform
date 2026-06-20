import {
  User,
  Bell,
  Shield,
  CreditCard,
  Wrench,
  Building,
} from 'lucide-react';
import { UserRole } from '@/lib/auth';
import type { TabConfig, PaymentProvider, TeamMember, NotificationSetting, ProgramPricing } from './types';

// Tab configuration with role-based access
export const tabsConfig: TabConfig[] = [
  {
    id: 'business',
    label: 'Business',
    icon: Building,
    // All roles can see, but only admin/owner can edit
    editableRoles: [UserRole.ADMIN, UserRole.OWNER],
  },
  {
    id: 'machines',
    label: 'Machines',
    icon: Wrench,
    // Only admin/owner/manager can see and edit
    allowedRoles: [UserRole.ADMIN, UserRole.OWNER, UserRole.MANAGER],
    editableRoles: [UserRole.ADMIN, UserRole.OWNER],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: Bell,
    // All roles can see and edit their own notifications
  },
  {
    id: 'payments',
    label: 'Payments',
    icon: CreditCard,
    // Only admin/owner can see payments
    allowedRoles: [UserRole.ADMIN, UserRole.OWNER],
    editableRoles: [UserRole.ADMIN, UserRole.OWNER],
  },
  {
    id: 'users',
    label: 'Users',
    icon: User,
    // All roles can see team members, but only admin/owner/manager can manage
    editableRoles: [UserRole.ADMIN, UserRole.OWNER, UserRole.MANAGER],
  },
  {
    id: 'security',
    label: 'Security',
    icon: Shield,
    // All roles can manage their own security settings
  },
];

// Payment providers configuration
export const paymentProviders: PaymentProvider[] = [
  { name: 'CamPay', enabled: true, color: 'bg-blue-100' },
  { name: 'MTN MoMo', enabled: true, color: 'bg-yellow-100' },
  { name: 'Orange Money', enabled: true, color: 'bg-orange-100' },
  { name: 'Wave', enabled: true, color: 'bg-cyan-100' },
  { name: 'Nkwa', enabled: false, color: 'bg-purple-100' },
];

// Mock team members (will be replaced with API data)
export const mockTeamMembers: TeamMember[] = [
  { name: 'Admin User', email: 'admin@smartlaundry.cm', role: 'Owner' },
  { name: 'Marie Nguema', email: 'marie@smartlaundry.cm', role: 'Manager' },
  { name: 'Jean-Pierre', email: 'jp@smartlaundry.cm', role: 'Staff' },
];

// Notification settings configuration
export const notificationSettings: NotificationSetting[] = [
  { label: 'Machine errors', desc: 'Get notified when a machine reports an error', default: true },
  { label: 'Maintenance alerts', desc: 'Reminders for scheduled maintenance', default: true },
  { label: 'Daily summary', desc: 'Receive daily revenue and usage summary', default: true },
  { label: 'Low revenue alert', desc: 'Alert when daily revenue is below target', default: false },
  { label: 'New transactions', desc: 'Notification for each transaction', default: false },
];

// Program pricing configuration
export const programPricing: ProgramPricing[] = [
  { name: 'Express', price: 2500 },
  { name: 'Standard', price: 3000 },
  { name: 'Intensif', price: 4000 },
  { name: 'Dryer - Low', price: 1500 },
  { name: 'Dryer - High', price: 2000 },
];
