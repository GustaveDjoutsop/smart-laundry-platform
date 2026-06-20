'use client';

import { useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { styles } from './styles';
import type { ManualEntryModalProps } from './types';
import { getErrorMessage } from '@/lib/utils';

export default function ManualEntryModal({
  isOpen,
  onClose,
  onSubmit,
  employees,
}: ManualEntryModalProps) {
  const [employeeId, setEmployeeId] = useState('');
  const [type, setType] = useState<'clock_in' | 'clock_out'>('clock_in');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!employeeId || !date || !time) {
      setError('Please fill in all required fields');
      return;
    }

    const timestamp = `${date}T${time}:00`;

    setIsSubmitting(true);
    try {
      await onSubmit({
        employeeId,
        type,
        timestamp,
        notes: notes.trim() || undefined,
      });
      // Reset form
      setEmployeeId('');
      setType('clock_in');
      setDate('');
      setTime('');
      setNotes('');
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to create time entry.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setError('');
      onClose();
    }
  };

  return (
    <div className={styles.modal.overlay} onClick={handleClose}>
      <div className={styles.modal.container} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modal.header}>
          <h3 className={styles.modal.title}>Add Manual Entry</h3>
          <button onClick={handleClose} className={styles.modal.closeButton} disabled={isSubmitting}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className={styles.modal.body}>
            {error && (
              <div className="p-3 bg-danger-50 border border-danger-200 rounded-lg text-sm text-danger-700">
                {error}
              </div>
            )}

            {/* Employee Select */}
            <div>
              <label className={styles.modal.label}>Employee *</label>
              <select
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                className={styles.modal.select}
                disabled={isSubmitting}
                required
              >
                <option value="">Select employee...</option>
                {employees.map((emp) => (
                  <option key={emp._id} value={emp._id}>
                    {emp.name} ({emp.email})
                  </option>
                ))}
              </select>
            </div>

            {/* Type Select */}
            <div>
              <label className={styles.modal.label}>Entry Type *</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as 'clock_in' | 'clock_out')}
                className={styles.modal.select}
                disabled={isSubmitting}
              >
                <option value="clock_in">Clock In</option>
                <option value="clock_out">Clock Out</option>
              </select>
            </div>

            {/* Date */}
            <div>
              <label className={styles.modal.label}>Date *</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={styles.modal.input}
                disabled={isSubmitting}
                required
              />
            </div>

            {/* Time */}
            <div>
              <label className={styles.modal.label}>Time *</label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className={styles.modal.input}
                disabled={isSubmitting}
                required
              />
            </div>

            {/* Notes */}
            <div>
              <label className={styles.modal.label}>Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className={styles.modal.input}
                rows={3}
                placeholder="Optional notes..."
                disabled={isSubmitting}
              />
            </div>
          </div>

          <div className={styles.modal.footer}>
            <button
              type="button"
              onClick={handleClose}
              className={styles.modal.cancelButton}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.modal.submitButton}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin inline" />
                  Creating...
                </>
              ) : (
                'Create Entry'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
