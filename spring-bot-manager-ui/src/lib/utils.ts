import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatDistanceToNow, format } from 'date-fns';
import type { BotType } from '@/types';

/**
 * Merge Tailwind CSS classes with clsx
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format an ISO date string to a human-readable relative time
 * e.g. "3 minutes ago"
 */
export function formatRelativeTime(dateStr: string): string {
  try {
    return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
  } catch {
    return dateStr;
  }
}

/**
 * Format an ISO date string to a locale date/time string
 */
export function formatDateTime(dateStr: string): string {
  try {
    return format(new Date(dateStr), 'dd MMM yyyy, HH:mm');
  } catch {
    return dateStr;
  }
}

/**
 * Format an ISO date string to a short date
 */
export function formatDate(dateStr: string): string {
  try {
    return format(new Date(dateStr), 'dd MMM yyyy');
  } catch {
    return dateStr;
  }
}

/**
 * Get human-readable label for a bot type
 */
export function getBotTypeLabel(botType: BotType): string {
  const labels: Record<string, string> = {
    laundry: 'Laundry',
    thomas_network: 'Thomas Network',
    pharmacy: 'Pharmacy',
  };
  return labels[botType] ?? botType;
}

/**
 * Get Tailwind background color class for a bot type
 */
export function getBotTypeBgColor(botType: BotType): string {
  const colors: Record<string, string> = {
    laundry: 'bg-sky-100 text-sky-700',
    thomas_network: 'bg-violet-100 text-violet-700',
    pharmacy: 'bg-emerald-100 text-emerald-700',
  };
  return colors[botType] ?? 'bg-gray-100 text-gray-700';
}

/**
 * Get Tailwind dot color class for bot enabled/disabled status
 */
export function getBotStatusColor(enabled: boolean): string {
  return enabled ? 'bg-green-500' : 'bg-gray-400';
}

/**
 * Get status text
 */
export function getBotStatusLabel(enabled: boolean): string {
  return enabled ? 'Active' : 'Inactive';
}

/**
 * Get status badge classes
 */
export function getBotStatusBadgeClasses(enabled: boolean): string {
  return enabled
    ? 'bg-green-50 text-green-700 ring-green-600/20'
    : 'bg-gray-50 text-gray-600 ring-gray-500/20';
}

/**
 * Truncate a string to a max length
 */
export function truncate(str: string, maxLength = 40): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + '…';
}

/**
 * Safely parse JSON, returning null on failure
 */
export function safeParseJson(value: string): Record<string, unknown> | null {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}
