'use client';

import { useState, useEffect } from 'react';
import { Clock, LogIn, LogOut, Loader2 } from 'lucide-react';
import { styles } from './styles';
import type { TimeClockCardProps } from './types';

export default function TimeClockCard({
  status,
  isLoading,
  onClockIn,
  onClockOut,
}: TimeClockCardProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentDuration, setCurrentDuration] = useState<string>('');

  // Update duration every second when clocked in
  useEffect(() => {
    if (!status?.isClockedIn || !status.currentSessionDuration) {
      setCurrentDuration('');
      return;
    }

    const updateDuration = () => {
      const startTime = new Date(status.currentSessionDuration!.startTime).getTime();
      const now = Date.now();
      const diffMs = now - startTime;
      const hours = Math.floor(diffMs / 3600000);
      const minutes = Math.floor((diffMs % 3600000) / 60000);
      const seconds = Math.floor((diffMs % 60000) / 1000);
      setCurrentDuration(
        `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
      );
    };

    updateDuration();
    const interval = setInterval(updateDuration, 1000);

    return () => clearInterval(interval);
  }, [status?.isClockedIn, status?.currentSessionDuration]);

  const handleClockIn = async () => {
    setIsSubmitting(true);
    try {
      await onClockIn();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClockOut = async () => {
    setIsSubmitting(true);
    try {
      await onClockOut();
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (isLoading) {
    return (
      <div className={styles.clockCard.container}>
        <div className={styles.clockCard.header}>
          <h3 className={styles.clockCard.title}>Time Clock</h3>
        </div>
        <div className={styles.clockCard.body}>
          <div className="flex justify-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
          </div>
        </div>
      </div>
    );
  }

  const isClockedIn = status?.isClockedIn ?? false;

  return (
    <div className={styles.clockCard.container}>
      <div className={styles.clockCard.header}>
        <h3 className={styles.clockCard.title}>Time Clock</h3>
      </div>
      <div className={styles.clockCard.body}>
        {/* Status Badge */}
        <div className={styles.clockCard.statusContainer}>
          <div
            className={`${styles.clockCard.statusBadge.base} ${
              isClockedIn
                ? styles.clockCard.statusBadge.clockedIn
                : styles.clockCard.statusBadge.clockedOut
            }`}
          >
            <Clock className={styles.clockCard.statusIcon} />
            {isClockedIn ? 'Clocked In' : 'Clocked Out'}
          </div>
        </div>

        {/* Duration Display */}
        <div className={styles.clockCard.durationContainer}>
          <p className={styles.clockCard.durationLabel}>
            {isClockedIn ? 'Current Session' : 'Ready to clock in'}
          </p>
          <p className={styles.clockCard.durationValue}>
            {isClockedIn ? currentDuration || '00:00:00' : '--:--:--'}
          </p>
          {isClockedIn && status?.currentSessionDuration && (
            <p className={styles.clockCard.startTime}>
              Started at {formatTime(status.currentSessionDuration.startTime)}
            </p>
          )}
        </div>

        {/* Clock In/Out Button */}
        <div className={styles.clockCard.buttonContainer}>
          {isClockedIn ? (
            <button
              onClick={handleClockOut}
              disabled={isSubmitting}
              className={`${styles.clockCard.clockButton.base} ${styles.clockCard.clockButton.clockOut} ${
                isSubmitting ? styles.clockCard.clockButton.disabled : ''
              }`}
            >
              {isSubmitting ? (
                <Loader2 className={`${styles.clockCard.buttonIcon} animate-spin`} />
              ) : (
                <LogOut className={styles.clockCard.buttonIcon} />
              )}
              Clock Out
            </button>
          ) : (
            <button
              onClick={handleClockIn}
              disabled={isSubmitting}
              className={`${styles.clockCard.clockButton.base} ${styles.clockCard.clockButton.clockIn} ${
                isSubmitting ? styles.clockCard.clockButton.disabled : ''
              }`}
            >
              {isSubmitting ? (
                <Loader2 className={`${styles.clockCard.buttonIcon} animate-spin`} />
              ) : (
                <LogIn className={styles.clockCard.buttonIcon} />
              )}
              Clock In
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
