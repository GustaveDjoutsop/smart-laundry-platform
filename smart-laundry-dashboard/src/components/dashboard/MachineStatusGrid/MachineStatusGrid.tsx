'use client';

import { WashingMachine, Wind, AlertCircle, Clock, CheckCircle } from 'lucide-react';
import { cn, formatTime } from '@/lib/utils';
import { styles, statusStyles, statusLabels } from './styles';
import type { MachineStatusGridProps, MachineCardProps, MachineStatusType } from './types';

const statusIcons = {
  available: CheckCircle,
  in_use: Clock,
  completing: Clock,
  error: AlertCircle,
  maintenance: AlertCircle,
  offline: AlertCircle,
};

export default function MachineStatusGrid({ machines }: MachineStatusGridProps) {
  const washers = machines.filter((m) => m.type === 'washer');
  const dryers = machines.filter((m) => m.type === 'dryer');
  const activeCount = machines.filter((m) => m.status === 'in_use').length;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.title}>Machine Status</h3>
        <span className={styles.activeCount}>{activeCount} active</span>
      </div>

      {/* Washers Section */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <WashingMachine className={cn(styles.sectionIcon, styles.sectionIconWasher)} />
          <span className={styles.sectionLabel}>Washers</span>
        </div>
        <div className={styles.gridWashers}>
          {washers.map((machine) => (
            <MachineCard key={machine.id} machine={machine} />
          ))}
        </div>
      </div>

      {/* Dryers Section */}
      <div className={styles.sectionLast}>
        <div className={styles.sectionHeader}>
          <Wind className={cn(styles.sectionIcon, styles.sectionIconDryer)} />
          <span className={styles.sectionLabel}>Dryers</span>
        </div>
        <div className={styles.gridDryers}>
          {dryers.map((machine) => (
            <MachineCard key={machine.id} machine={machine} />
          ))}
        </div>
      </div>
    </div>
  );
}

function MachineCard({ machine }: MachineCardProps) {
  const status = machine.status as MachineStatusType;
  const StatusIcon = statusIcons[status];
  const statusStyle = statusStyles[status];

  return (
    <div className={cn(styles.card.base, statusStyle.border, statusStyle.bg)}>
      <div className={styles.card.header}>
        <span className={styles.card.name}>{machine.name}</span>
        <StatusIcon className={cn(styles.card.statusIcon, statusStyle.icon)} />
      </div>

      <div className={styles.card.details}>
        {status === 'in_use' && machine.timeRemaining ? (
          <span>{formatTime(machine.timeRemaining)} remaining</span>
        ) : status === 'completing' ? (
          <span>Cycle complete</span>
        ) : status === 'error' ? (
          <span className={styles.card.errorText}>{machine.lastError?.message || 'Error'}</span>
        ) : (
          <span>{statusLabels[status]}</span>
        )}
      </div>

      {machine.currentProgram && (
        <div className={styles.card.program}>{machine.currentProgram}</div>
      )}
    </div>
  );
}
