'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Eye, EyeOff, Info } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { botsApi } from '@/lib/api';
import { cn, safeParseJson } from '@/lib/utils';
import { BOT_TYPES } from '@/types';
import type { BotConfigRequest, BotConfigResponse, BotUpdateRequest } from '@/types';

interface BotFormProps {
  /** Existing bot data for edit mode */
  bot?: BotConfigResponse;
  mode: 'create' | 'edit';
}

interface FormState {
  botId: string;
  botName: string;
  botType: string;
  phoneNumberId: string;
  verifyToken: string;
  accessToken: string;
  appSecret: string;
  configJson: string;
  enabled: boolean;
}

function InputField({
  label,
  id,
  required,
  type = 'text',
  value,
  onChange,
  placeholder,
  hint,
  disabled,
  monospace,
}: {
  label: string;
  id: string;
  required?: boolean;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  disabled?: boolean;
  monospace?: boolean;
}) {
  const [show, setShow] = useState(false);
  const isPassword = type === 'password';
  const inputType = isPassword ? (show ? 'text' : 'password') : type;

  return (
    <div>
      <label
        htmlFor={id}
        className="flex items-center gap-1 text-sm font-medium text-gray-700"
      >
        {label}
        {required && <span className="text-red-500">*</span>}
        {hint && (
          <span title={hint}>
            <Info className="h-3.5 w-3.5 text-gray-300" />
          </span>
        )}
      </label>
      <div className="relative mt-1">
        <input
          id={id}
          type={inputType}
          required={required}
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={cn(
            'block w-full rounded-lg border px-3 py-2 text-sm shadow-sm',
            'placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500',
            'border-gray-300 bg-white text-gray-900',
            disabled && 'cursor-not-allowed bg-gray-50 text-gray-400',
            isPassword && 'pr-10',
            monospace && 'font-mono'
          )}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShow(!show)}
            className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600"
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </div>
    </div>
  );
}

export function BotForm({ bot, mode }: BotFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<FormState>({
    botId: bot?.botId ?? '',
    botName: bot?.botName ?? '',
    botType: bot?.botType ?? '',
    phoneNumberId: bot?.phoneNumberId ?? '',
    verifyToken: '',
    accessToken: '',
    appSecret: '',
    configJson: bot?.config ? JSON.stringify(bot.config, null, 2) : '',
    enabled: bot?.enabled ?? true,
  });

  const [configError, setConfigError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function validateConfig(): Record<string, unknown> | undefined {
    if (!form.configJson.trim()) return undefined;
    const parsed = safeParseJson(form.configJson);
    if (!parsed) {
      setConfigError('Invalid JSON – please fix the config before saving.');
      return undefined;
    }
    setConfigError(null);
    return parsed;
  }

  // CREATE mutation
  const createMutation = useMutation({
    mutationFn: (data: BotConfigRequest) => botsApi.create(data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['bots'] });
      router.push(`/dashboard/bots/${res.data.botId}`);
    },
    onError: (err: unknown) => {
      const detail =
        (err as { response?: { data?: { detail?: string; error?: string } } })
          ?.response?.data?.detail ??
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error ??
        'Something went wrong. Please try again.';
      setServerError(detail);
    },
  });

  // UPDATE mutation
  const updateMutation = useMutation({
    mutationFn: (data: BotUpdateRequest) => botsApi.update(bot!.botId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bots'] });
      queryClient.invalidateQueries({ queryKey: ['bot', bot!.botId] });
      router.push(`/dashboard/bots/${bot!.botId}`);
    },
    onError: (err: unknown) => {
      const detail =
        (err as { response?: { data?: { detail?: string; error?: string } } })
          ?.response?.data?.detail ??
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error ??
        'Something went wrong. Please try again.';
      setServerError(detail);
    },
  });

  const isLoading = createMutation.isPending || updateMutation.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);

    const config = form.configJson.trim() ? validateConfig() : undefined;
    if (form.configJson.trim() && !config) return; // JSON validation failed

    if (mode === 'create') {
      const payload: BotConfigRequest = {
        botId: form.botId,
        botName: form.botName || undefined,
        botType: form.botType,
        phoneNumberId: form.phoneNumberId,
        verifyToken: form.verifyToken || undefined,
        accessToken: form.accessToken || undefined,
        appSecret: form.appSecret || undefined,
        config,
        enabled: form.enabled,
      };
      createMutation.mutate(payload);
    } else {
      const payload: BotUpdateRequest = {
        botName: form.botName || undefined,
        botType: form.botType || undefined,
        phoneNumberId: form.phoneNumberId || undefined,
        verifyToken: form.verifyToken || undefined,
        accessToken: form.accessToken || undefined,
        appSecret: form.appSecret || undefined,
        config,
        enabled: form.enabled,
      };
      updateMutation.mutate(payload);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* ── Identity ── */}
      <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-6 py-4">
          <h3 className="text-sm font-semibold text-gray-900">Bot Identity</h3>
          <p className="text-xs text-gray-400">
            Core identifiers — some cannot be changed after creation.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-5 p-6 sm:grid-cols-2">
          <InputField
            id="botId"
            label="Bot ID"
            required
            value={form.botId}
            onChange={(v) => setField('botId', v)}
            placeholder="e.g. laundry-douala"
            hint="Unique slug identifier. Cannot be changed after creation."
            disabled={mode === 'edit'}
            monospace
          />
          <InputField
            id="botName"
            label="Bot Name"
            value={form.botName}
            onChange={(v) => setField('botName', v)}
            placeholder="e.g. Smart Laundry Bot"
          />

          {/* Bot Type */}
          <div>
            <label
              htmlFor="botType"
              className="flex items-center gap-1 text-sm font-medium text-gray-700"
            >
              Bot Type <span className="text-red-500">*</span>
            </label>
            <select
              id="botType"
              required
              value={form.botType}
              onChange={(e) => setField('botType', e.target.value)}
              className={cn(
                'mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm',
                'focus:outline-none focus:ring-2 focus:ring-brand-500'
              )}
            >
              <option value="">Select a type…</option>
              {BOT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <InputField
            id="phoneNumberId"
            label="WhatsApp Phone Number ID"
            required
            value={form.phoneNumberId}
            onChange={(v) => setField('phoneNumberId', v)}
            placeholder="e.g. 954151401109786"
            hint="The Meta Phone Number ID for this bot's WhatsApp number."
            monospace
          />
        </div>
      </section>

      {/* ── Credentials ── */}
      <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-6 py-4">
          <h3 className="text-sm font-semibold text-gray-900">
            WhatsApp Credentials
          </h3>
          <p className="text-xs text-gray-400">
            Stored encrypted. Leave blank to keep the existing value.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-5 p-6 sm:grid-cols-3">
          <InputField
            id="verifyToken"
            label="Verify Token"
            type="password"
            value={form.verifyToken}
            onChange={(v) => setField('verifyToken', v)}
            placeholder={
              mode === 'edit' && bot?.hasVerifyToken ? '(unchanged)' : 'Enter verify token'
            }
            hint="Used to verify the WhatsApp webhook."
          />
          <InputField
            id="accessToken"
            label="Access Token"
            type="password"
            value={form.accessToken}
            onChange={(v) => setField('accessToken', v)}
            placeholder={
              mode === 'edit' && bot?.hasAccessToken ? '(unchanged)' : 'Enter access token'
            }
            hint="Meta Graph API access token for sending messages."
          />
          <InputField
            id="appSecret"
            label="App Secret"
            type="password"
            value={form.appSecret}
            onChange={(v) => setField('appSecret', v)}
            placeholder={
              mode === 'edit' && bot?.hasAppSecret ? '(unchanged)' : 'Enter app secret'
            }
            hint="Used to verify webhook payload signatures."
          />
        </div>
      </section>

      {/* ── Advanced Config ── */}
      <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-6 py-4">
          <h3 className="text-sm font-semibold text-gray-900">
            Advanced Configuration
          </h3>
          <p className="text-xs text-gray-400">
            Optional JSON config (business hours, machines, flows, etc.).
          </p>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label
              htmlFor="configJson"
              className="text-sm font-medium text-gray-700"
            >
              Config JSON
            </label>
            <textarea
              id="configJson"
              rows={12}
              value={form.configJson}
              onChange={(e) => {
                setField('configJson', e.target.value);
                setConfigError(null);
              }}
              placeholder={'{\n  "businessHours": { "openTime": "07:00", "closeTime": "22:00" }\n}'}
              className={cn(
                'mt-1 block w-full rounded-lg border px-3 py-2 font-mono text-xs shadow-sm',
                'placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-500',
                configError
                  ? 'border-red-400 bg-red-50'
                  : 'border-gray-300 bg-white text-gray-900'
              )}
            />
            {configError && (
              <p className="mt-1 text-xs text-red-600">{configError}</p>
            )}
          </div>

          {/* Enabled toggle */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={form.enabled}
              onClick={() => setField('enabled', !form.enabled)}
              className={cn(
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2',
                form.enabled ? 'bg-brand-600' : 'bg-gray-200'
              )}
            >
              <span
                className={cn(
                  'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
                  form.enabled ? 'translate-x-6' : 'translate-x-1'
                )}
              />
            </button>
            <span className="text-sm font-medium text-gray-700">
              {form.enabled ? 'Bot enabled (active)' : 'Bot disabled (inactive)'}
            </span>
          </div>
        </div>
      </section>

      {/* Error */}
      {serverError && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {serverError}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isLoading}
          className={cn(
            'flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white shadow-sm',
            'hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-60 transition-colors'
          )}
        >
          {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
          {mode === 'create' ? 'Create Bot' : 'Save Changes'}
        </button>
      </div>
    </form>
  );
}
