import { cn, getBotStatusBadgeClasses, getBotStatusLabel } from '@/lib/utils';

interface StatusBadgeProps {
  enabled: boolean;
  className?: string;
}

export function StatusBadge({ enabled, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
        getBotStatusBadgeClasses(enabled),
        className
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          enabled ? 'bg-green-500 status-pulse' : 'bg-gray-400'
        )}
      />
      {getBotStatusLabel(enabled)}
    </span>
  );
}
