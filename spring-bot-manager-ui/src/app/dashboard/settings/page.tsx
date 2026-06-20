'use client';

import { useState } from 'react';
import { Save, RefreshCw, Loader2 } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { botsApi } from '@/lib/api';
import { cn } from '@/lib/utils';

export default function SettingsPage() {
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  const [refreshResult, setRefreshResult] = useState<{
    botsLoaded: number;
    message: string;
  } | null>(null);

  const refreshMutation = useMutation({
    mutationFn: () => botsApi.refresh(),
    onSuccess: ({ data }) => {
      setRefreshResult({ botsLoaded: data.botsLoaded, message: data.message });
      setTimeout(() => setRefreshResult(null), 5000);
    },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Settings</h2>
        <p className="text-sm text-gray-500">
          Application configuration and admin actions.
        </p>
      </div>

      {/* API connection info */}
      <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-6 py-4">
          <h3 className="text-sm font-semibold text-gray-900">
            API Connection
          </h3>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Backend API URL
            </label>
            <p className="mt-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-sm text-gray-600">
              {apiUrl}
            </p>
            <p className="mt-1 text-xs text-gray-400">
              Set via{' '}
              <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs">
                NEXT_PUBLIC_API_URL
              </code>{' '}
              environment variable.
            </p>
          </div>
        </div>
      </section>

      {/* Bot Registry */}
      <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-6 py-4">
          <h3 className="text-sm font-semibold text-gray-900">Bot Registry</h3>
          <p className="text-xs text-gray-400">
            Publish a registry refresh event to hot-reload all active bots.
          </p>
        </div>
        <div className="p-6 space-y-4">
          {refreshResult && (
            <div className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">
              {refreshResult.message} — {refreshResult.botsLoaded} bot(s)
              loaded.
            </div>
          )}

          <button
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
            className={cn(
              'flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2',
              'text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors',
              'disabled:cursor-not-allowed disabled:opacity-60'
            )}
          >
            {refreshMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Trigger Registry Refresh
          </button>
        </div>
      </section>

      {/* About */}
      <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-6 py-4">
          <h3 className="text-sm font-semibold text-gray-900">About</h3>
        </div>
        <div className="divide-y divide-gray-100 px-6">
          {[
            { label: 'Application', value: 'Spring Bot Manager UI' },
            { label: 'Version', value: '0.1.0' },
            { label: 'Framework', value: 'Next.js 14 (App Router)' },
            { label: 'Backend', value: 'Spring Boot — spring-bot-manager' },
          ].map(({ label, value }) => (
            <div
              key={label}
              className="flex items-center justify-between py-3"
            >
              <span className="text-sm text-gray-500">{label}</span>
              <span className="text-sm font-medium text-gray-900">{value}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
