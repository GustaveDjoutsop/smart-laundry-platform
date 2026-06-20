'use client';

import {
  Palmtree,
  Thermometer,
  User,
  CalendarMinus,
  Users,
  GraduationCap,
  Loader2,
} from 'lucide-react';
import { styles } from './styles';
import { absenceTypeConfig } from './types';
import type { AbsenceSummaryCardProps, AbsenceType } from './types';

const typeIcons: Record<AbsenceType, React.ReactNode> = {
  vacation: <Palmtree className="w-6 h-6" />,
  sick: <Thermometer className="w-6 h-6" />,
  personal: <User className="w-6 h-6" />,
  unpaid_leave: <CalendarMinus className="w-6 h-6" />,
  family_emergency: <Users className="w-6 h-6" />,
  training: <GraduationCap className="w-6 h-6" />,
};

export default function AbsenceSummaryCard({
  summary,
  isLoading,
  year,
}: AbsenceSummaryCardProps) {
  if (isLoading) {
    return (
      <div className={styles.summary.container}>
        <div className={styles.summary.header}>
          <h3 className={styles.summary.title}>Absence Summary - {year}</h3>
        </div>
        <div className={styles.summary.body}>
          <div className="flex justify-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
          </div>
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className={styles.summary.container}>
        <div className={styles.summary.header}>
          <h3 className={styles.summary.title}>Absence Summary - {year}</h3>
        </div>
        <div className={styles.summary.body}>
          <div className="text-center py-8 text-gray-500">
            <p>No data available</p>
          </div>
        </div>
      </div>
    );
  }

  const absenceTypes: AbsenceType[] = [
    'vacation',
    'sick',
    'personal',
    'unpaid_leave',
    'family_emergency',
    'training',
  ];

  return (
    <div className={styles.summary.container}>
      <div className={styles.summary.header}>
        <h3 className={styles.summary.title}>Absence Summary - {year}</h3>
      </div>
      <div className={styles.summary.body}>
        <div className={styles.summary.grid}>
          {absenceTypes.map((type) => {
            const config = absenceTypeConfig[type];
            const data = summary[type];
            return (
              <div
                key={type}
                className={`${styles.summary.statCard} ${config.bgColor}`}
              >
                <div className={`${styles.summary.statIcon} ${config.color}`}>
                  {typeIcons[type]}
                </div>
                <p className={styles.summary.statLabel}>{config.label}</p>
                <p className={`${styles.summary.statValue} ${config.color}`}>
                  {data.totalDays} days
                </p>
                <p className={styles.summary.statCount}>
                  {data.count} request{data.count !== 1 ? 's' : ''}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
