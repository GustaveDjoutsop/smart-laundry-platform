'use client';

import { Clock, Calendar, Loader2 } from 'lucide-react';
import { styles } from './styles';
import type { TimeEntrySummaryProps } from './types';

export default function TimeEntrySummaryCard({ summary, isLoading }: TimeEntrySummaryProps) {
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (isLoading) {
    return (
      <div className={styles.summaryCard.container}>
        <div className={styles.summaryCard.header}>
          <h3 className={styles.summaryCard.title}>Hours Summary</h3>
        </div>
        <div className={styles.summaryCard.body}>
          <div className="flex justify-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
          </div>
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className={styles.summaryCard.container}>
        <div className={styles.summaryCard.header}>
          <h3 className={styles.summaryCard.title}>Hours Summary</h3>
        </div>
        <div className={styles.summaryCard.body}>
          <div className="text-center py-8 text-gray-500">
            <p>No data available</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.summaryCard.container}>
      <div className={styles.summaryCard.header}>
        <h3 className={styles.summaryCard.title}>Hours Summary</h3>
      </div>
      <div className={styles.summaryCard.body}>
        {/* Stats Grid */}
        <div className={styles.summaryCard.grid}>
          <div className={styles.summaryCard.statCard}>
            <Clock className="w-6 h-6 mx-auto mb-2 text-primary-600" />
            <p className={styles.summaryCard.statLabel}>Total Hours</p>
            <p className={styles.summaryCard.statValue}>{summary.formattedDuration}</p>
          </div>
          <div className={styles.summaryCard.statCard}>
            <Calendar className="w-6 h-6 mx-auto mb-2 text-primary-600" />
            <p className={styles.summaryCard.statLabel}>Sessions</p>
            <p className={styles.summaryCard.statValue}>{summary.sessions.length}</p>
          </div>
        </div>

        {/* Sessions List */}
        {summary.sessions.length > 0 && (
          <div className={styles.summaryCard.sessionsList}>
            <h4 className="text-sm font-medium text-gray-700 mb-3">Recent Sessions</h4>
            {summary.sessions.slice(0, 5).map((session, index) => (
              <div key={index} className={styles.summaryCard.sessionItem}>
                <div>
                  <p className={styles.summaryCard.sessionDate}>{formatDate(session.date)}</p>
                  <p className={styles.summaryCard.sessionTime}>
                    {formatTime(session.clockIn)}
                    {session.clockOut && ` - ${formatTime(session.clockOut)}`}
                  </p>
                </div>
                <p
                  className={`${styles.summaryCard.sessionDuration} ${
                    session.isOpen
                      ? styles.summaryCard.sessionOpen
                      : styles.summaryCard.sessionClosed
                  }`}
                >
                  {session.duration}
                  {session.isOpen && ' (active)'}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
