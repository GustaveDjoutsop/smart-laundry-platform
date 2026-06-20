'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Bell,
  User,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Settings,
  LogOut,
  UserCircle,
  HelpCircle,
  ChevronDown,
  Shield,
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useAuth, getRoleDisplayName, getRoleBadgeColor } from '@/lib/auth';

interface Notification {
  id: string;
  type: 'error' | 'warning' | 'success' | 'info';
  title: string;
  message: string;
  time: Date;
  read: boolean;
}

interface HeaderProps {
  title: string;
  alertsCount?: number;
  notifications?: Notification[];
}

// Mock notifications - in real app, this would come from props or context
const defaultNotifications: Notification[] = [
  {
    id: '1',
    type: 'error',
    title: 'Machine Error',
    message: 'Washer 6 - Door lock error (E03)',
    time: new Date(Date.now() - 5 * 60000),
    read: false,
  },
  {
    id: '2',
    type: 'warning',
    title: 'Maintenance Due',
    message: 'Washer 5 has 420 cycles since last maintenance',
    time: new Date(Date.now() - 30 * 60000),
    read: false,
  },
  {
    id: '3',
    type: 'warning',
    title: 'Maintenance Due',
    message: 'Washer 3 approaching maintenance threshold',
    time: new Date(Date.now() - 2 * 60 * 60000),
    read: true,
  },
  {
    id: '4',
    type: 'success',
    title: 'Payment Received',
    message: '3,000 XAF from MTN MoMo - Washer 2',
    time: new Date(Date.now() - 3 * 60 * 60000),
    read: true,
  },
  {
    id: '5',
    type: 'info',
    title: 'Daily Report',
    message: 'Yesterday\'s revenue: 365,000 XAF',
    time: new Date(Date.now() - 12 * 60 * 60000),
    read: true,
  },
];

const notificationIcons = {
  error: XCircle,
  warning: AlertTriangle,
  success: CheckCircle,
  info: Bell,
};

const notificationColors = {
  error: 'text-danger-600 bg-danger-50',
  warning: 'text-warning-600 bg-warning-50',
  success: 'text-success-600 bg-success-50',
  info: 'text-primary-600 bg-primary-50',
};

export default function Header({
  title,
  alertsCount = 0,
  notifications = defaultNotifications,
}: HeaderProps) {
  const { user, logout, isAuthenticated } = useAuth();
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [localNotifications, setLocalNotifications] = useState(notifications);

  const notifRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  // Use auth user data or fallback
  const userName = user?.name || 'Guest';
  const userEmail = user?.email || '';
  const userRole = user?.role;

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
      if (userRef.current && !userRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const unreadCount = localNotifications.filter(n => !n.read).length;

  const markAsRead = (id: string) => {
    setLocalNotifications(prev =>
      prev.map(n => n.id === id ? { ...n, read: true } : n)
    );
  };

  const markAllAsRead = () => {
    setLocalNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const formatNotificationTime = (time: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - time.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  const handleLogout = async () => {
    setShowUserMenu(false);
    await logout();
  };

  return (
    <header className="flex items-center justify-between h-16 px-6 bg-white border-b border-gray-200">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
        <p className="text-sm text-gray-500">{format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
      </div>

      <div className="flex items-center space-x-4">
        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <button
            className="relative p-2 text-gray-400 hover:text-gray-600 transition-colors"
            onClick={() => {
              setShowNotifications(!showNotifications);
              setShowUserMenu(false);
            }}
          >
            <Bell className="w-6 h-6" />
            {(alertsCount > 0 || unreadCount > 0) && (
              <span className="absolute top-0 right-0 flex items-center justify-center w-5 h-5 text-xs font-medium text-white bg-danger-500 rounded-full">
                {(alertsCount || unreadCount) > 9 ? '9+' : (alertsCount || unreadCount)}
              </span>
            )}
          </button>

          {/* Notifications Dropdown */}
          {showNotifications && (
            <div className="absolute right-0 mt-2 w-96 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                <h3 className="font-semibold text-gray-900">Notifications</h3>
                {unreadCount > 0 && (
                  <button
                    onClick={markAllAsRead}
                    className="text-sm text-primary-600 hover:text-primary-700"
                  >
                    Mark all as read
                  </button>
                )}
              </div>

              <div className="max-h-96 overflow-y-auto">
                {localNotifications.length === 0 ? (
                  <div className="px-4 py-8 text-center text-gray-500">
                    <Bell className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                    <p>No notifications</p>
                  </div>
                ) : (
                  localNotifications.map((notification) => {
                    const Icon = notificationIcons[notification.type];
                    return (
                      <div
                        key={notification.id}
                        className={cn(
                          'flex items-start px-4 py-3 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-0',
                          !notification.read && 'bg-primary-50/30'
                        )}
                        onClick={() => markAsRead(notification.id)}
                      >
                        <div className={cn('p-2 rounded-lg mr-3', notificationColors[notification.type])}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <p className={cn(
                              'text-sm',
                              notification.read ? 'text-gray-600' : 'text-gray-900 font-medium'
                            )}>
                              {notification.title}
                            </p>
                            <span className="text-xs text-gray-400 ml-2">
                              {formatNotificationTime(notification.time)}
                            </span>
                          </div>
                          <p className="text-sm text-gray-500 truncate mt-0.5">
                            {notification.message}
                          </p>
                        </div>
                        {!notification.read && (
                          <div className="w-2 h-2 bg-primary-500 rounded-full ml-2 mt-2" />
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              <div className="px-4 py-3 border-t border-gray-200">
                <a
                  href="/dashboard/maintenance"
                  className="block text-center text-sm text-primary-600 hover:text-primary-700"
                >
                  View all alerts
                </a>
              </div>
            </div>
          )}
        </div>

        {/* User menu */}
        {isAuthenticated && (
          <div className="relative" ref={userRef}>
            <button
              className="flex items-center space-x-2 text-gray-600 hover:text-gray-900 transition-colors"
              onClick={() => {
                setShowUserMenu(!showUserMenu);
                setShowNotifications(false);
              }}
            >
              <div className="flex items-center justify-center w-8 h-8 bg-primary-100 rounded-full">
                <User className="w-5 h-5 text-primary-600" />
              </div>
              <span className="text-sm font-medium">{userName.split(' ')[0]}</span>
              <ChevronDown className={cn(
                'w-4 h-4 transition-transform',
                showUserMenu && 'rotate-180'
              )} />
            </button>

            {/* User Dropdown */}
            {showUserMenu && (
              <div className="absolute right-0 mt-2 w-72 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
                {/* User Info */}
                <div className="px-4 py-3 border-b border-gray-200">
                  <div className="flex items-center">
                    <div className="flex items-center justify-center w-10 h-10 bg-primary-100 rounded-full mr-3">
                      <User className="w-6 h-6 text-primary-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">{userName}</p>
                      <p className="text-sm text-gray-500 truncate">{userEmail}</p>
                    </div>
                  </div>
                  {/* Role Badge */}
                  {userRole && (
                    <div className="mt-2 flex items-center">
                      <Shield className="w-4 h-4 text-gray-400 mr-1.5" />
                      <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', getRoleBadgeColor(userRole))}>
                        {getRoleDisplayName(userRole)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Menu Items */}
                <div className="py-2">
                  <a
                    href="/dashboard/settings"
                    className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <UserCircle className="w-4 h-4 mr-3 text-gray-400" />
                    My Profile
                  </a>
                  <a
                    href="/dashboard/settings"
                    className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <Settings className="w-4 h-4 mr-3 text-gray-400" />
                    Settings
                  </a>
                  <a
                    href="#"
                    className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <HelpCircle className="w-4 h-4 mr-3 text-gray-400" />
                    Help & Support
                  </a>
                </div>

                {/* Logout */}
                <div className="border-t border-gray-200 py-2">
                  <button
                    className="flex items-center w-full px-4 py-2 text-sm text-danger-600 hover:bg-danger-50"
                    onClick={handleLogout}
                  >
                    <LogOut className="w-4 h-4 mr-3" />
                    Sign Out
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
