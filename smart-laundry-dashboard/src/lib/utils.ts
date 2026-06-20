import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import axios from 'axios';

/**
 * Extracts a human-readable message from any thrown value.
 *
 * Priority:
 *  1. Server-supplied message in the response body (message / error / reason)
 *  2. HTTP status code → friendly sentence
 *  3. Network-level error (no response from server)
 *  4. Caller-supplied fallback
 *  5. Generic "unexpected error"
 */
export function getErrorMessage(err: unknown, fallback?: string): string {
  if (axios.isAxiosError(err)) {
    // 1. Try to extract a message from the response body
    const data = err.response?.data as Record<string, unknown> | undefined;
    if (data) {
      const serverMsg =
        (typeof data.message === 'string' && data.message) ||
        (typeof data.error   === 'string' && data.error)   ||
        (typeof data.reason  === 'string' && data.reason);
      // Suppress raw Auth0 sandbox errors — replace with a friendly message
      if (serverMsg && !serverMsg.startsWith('Sandbox Error')) {
        return serverMsg;
      }
    }

    // 2. Map status codes to friendly sentences
    const status = err.response?.status;
    if (status) {
      if (status === 400) return fallback ?? 'Invalid request — please check your input and try again.';
      if (status === 401) return 'Your session has expired. Please sign in again.';
      if (status === 403) return "You don't have permission to perform this action.";
      if (status === 404) return fallback ?? 'The requested resource was not found.';
      if (status === 409) return fallback ?? 'A conflict occurred — this record may already exist.';
      if (status === 422) return fallback ?? 'Validation failed — please check your input.';
      if (status === 429) return 'Too many requests — please wait a moment and try again.';
      if (status >= 500)  return 'Server error — please try again in a moment.';
    }

    // 3. Network-level failure (no response)
    if (!err.response) return 'Network error — check your connection and try again.';
  }

  // 4. Caller fallback or generic
  return fallback ?? 'An unexpected error occurred. Please try again.';
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, currency = 'XAF'): string {
  // Use a consistent format to avoid hydration mismatches between server/client
  const formatted = Math.round(amount).toLocaleString('en-US');
  return `${formatted} ${currency}`;
}

export function formatNumber(num: number): string {
  return new Intl.NumberFormat('fr-CM').format(num);
}

export function formatDate(date: Date | string, options?: Intl.DateTimeFormatOptions): string {
  const d = typeof date === 'string' ? new Date(date) : date;

  // Use consistent formatting to avoid hydration mismatches
  if (options?.timeStyle === 'short' && options?.dateStyle === undefined) {
    // Time only format
    const hours = d.getHours().toString().padStart(2, '0');
    const minutes = d.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  // Default date + time format
  const day = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const year = d.getFullYear();
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');

  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

export function formatTime(minutes: number): string {
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hrs > 0) {
    return `${hrs}h ${mins}m`;
  }
  return `${mins}m`;
}

export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    available: 'bg-success-500',
    in_use: 'bg-primary-500',
    completing: 'bg-warning-500',
    error: 'bg-danger-500',
    maintenance: 'bg-warning-500',
    offline: 'bg-gray-400',
    completed: 'bg-success-500',
    pending: 'bg-warning-500',
    failed: 'bg-danger-500',
  };
  return colors[status] || 'bg-gray-400';
}

export function getSeverityColor(severity: string): string {
  const colors: Record<string, string> = {
    low: 'text-yellow-600 bg-yellow-50',
    medium: 'text-orange-600 bg-orange-50',
    high: 'text-red-600 bg-red-50',
  };
  return colors[severity] || 'text-gray-600 bg-gray-50';
}
