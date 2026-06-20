'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  WashingMachine,
  CreditCard,
  TrendingUp,
  Wrench,
  FileText,
  Coffee,
  Settings,
  LogOut,
  Receipt,
  MessageSquare,
  Users,
  Clock,
  CalendarOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { UserRole } from '@/lib/auth/types';

interface NavigationItem {
  name: string;
  href: string;
  icon: LucideIcon;
  permission?: string;
  roles?: UserRole[];
}

// Navigation items with permission/role requirements
const navigation: NavigationItem[] = [
  {
    name: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
    permission: 'dashboard:view',
  },
  {
    name: 'Machines',
    href: '/dashboard/machines',
    icon: WashingMachine,
    permission: 'machines:read',
  },
  {
    name: 'Transactions',
    href: '/dashboard/transactions',
    icon: CreditCard,
    permission: 'transactions:read',
  },
  {
    name: 'Revenue',
    href: '/dashboard/revenue',
    icon: TrendingUp,
    permission: 'finance:dashboard',
  },
  {
    name: 'Expenses',
    href: '/dashboard/expenses',
    icon: Receipt,
    permission: 'expenses:view',
  },
  {
    name: 'Feedback',
    href: '/dashboard/feedback',
    icon: MessageSquare,
    roles: [UserRole.ADMIN, UserRole.OWNER, UserRole.MANAGER, UserRole.ACCOUNTANT],
  },
  {
    name: 'Maintenance',
    href: '/dashboard/maintenance',
    icon: Wrench,
    permission: 'machines:maintenance',
  },
  {
    name: 'Reports',
    href: '/dashboard/reports',
    icon: FileText,
    permission: 'finance:reports',
  },
  {
    name: 'Users',
    href: '/dashboard/users',
    icon: Users,
    permission: 'users:read',
  },
  {
    name: 'Timekeeping',
    href: '/dashboard/timekeeping',
    icon: Clock,
    permission: 'timekeeping:view_own',
  },
  {
    name: 'Absences',
    href: '/dashboard/absences',
    icon: CalendarOff,
    permission: 'absences:view_all',
  },
  {
    name: 'Café',
    href: '/dashboard/cafe',
    icon: Coffee,
    permission: 'cafe:view',
  },
  {
    name: 'Settings',
    href: '/dashboard/settings',
    icon: Settings,
    permission: 'system:settings',
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout, checkPermission, checkRole } = useAuth();

  // Filter navigation items based on user permissions/roles
  const filteredNavigation = navigation.filter((item) => {
    // If user is not authenticated, hide all items
    if (!user) return false;

    // Check permission if specified
    if (item.permission) {
      return checkPermission(item.permission);
    }

    // Check roles if specified
    if (item.roles) {
      return checkRole(item.roles);
    }

    // If no permission or role requirement, show the item
    return true;
  });

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white border-r border-gray-200 w-64">
      {/* Logo */}
      <div className="flex items-center h-16 px-6 border-b border-gray-200">
        <WashingMachine className="w-8 h-8 text-primary-600" />
        <span className="ml-2 text-lg font-semibold text-gray-900">
          Smart Laundry
        </span>
      </div>

      {/* User info */}
      {user && (
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
          <p className="text-sm font-medium text-gray-900 truncate">{user.name}</p>
          <p className="text-xs text-gray-500 capitalize">{user.role}</p>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {filteredNavigation.map((item) => {
          const isActive = pathname === item.href ||
            (item.href !== '/dashboard' && pathname.startsWith(item.href));

          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors',
                isActive
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              )}
            >
              <item.icon
                className={cn(
                  'mr-3 h-5 w-5',
                  isActive ? 'text-primary-600' : 'text-gray-400'
                )}
              />
              {item.name}
            </Link>
          );
        })}
      </nav>

      {/* User section */}
      <div className="p-4 border-t border-gray-200">
        <button
          onClick={handleLogout}
          className="flex items-center w-full px-3 py-2 text-sm font-medium text-gray-600 rounded-md hover:bg-gray-50 hover:text-gray-900"
        >
          <LogOut className="w-5 h-5 mr-3 text-gray-400" />
          Sign out
        </button>
      </div>
    </div>
  );
}
