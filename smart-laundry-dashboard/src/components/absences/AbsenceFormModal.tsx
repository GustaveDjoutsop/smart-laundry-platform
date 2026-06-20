'use client';

import { useState, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';
import { styles } from './styles';
import { absenceTypeConfig } from './types';
import type { AbsenceFormModalProps, AbsenceType } from './types';
import { getErrorMessage } from '@/lib/utils';

const ABSENCE_TYPES: AbsenceType[] = [
  'vacation',
  'sick',
  'personal',
  'unpaid_leave',
  'family_emergency',
  'training',
];

export default function AbsenceFormModal({
  isOpen,
  onClose,
  onSubmit,
  employees,
  canAssignToOthers = false,
  editingAbsence,
}: AbsenceFormModalProps) {
  const [employeeId, setEmployeeId] = useState('');
  const [type, setType] = useState<AbsenceType>('vacation');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Reset form when modal opens/closes or when editing
  useEffect(() => {
    if (isOpen) {
      if (editingAbsence) {
        setEmployeeId(editingAbsence.employee._id);
        setType(editingAbsence.type);
        setStartDate(editingAbsence.startDate.split('T')[0]);
        setEndDate(editingAbsence.endDate.split('T')[0]);
        setReason(editingAbsence.reason || '');
      } else {
        setEmployeeId('');
        setType('vacation');
        setStartDate('');
        setEndDate('');
        setReason('');
      }
      setError('');
    }
  }, [isOpen, editingAbsence]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!type || !startDate || !endDate) {
      setError('Please fill in all required fields');
      return;
    }

    if (new Date(startDate) > new Date(endDate)) {
      setError('Start date must be before or equal to end date');
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit({
        employeeId: canAssignToOthers && employeeId ? employeeId : undefined,
        type,
        startDate,
        endDate,
        reason: reason.trim() || undefined,
      });
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to submit absence request.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      onClose();
    }
  };

  return (
    <div className={styles.modal.overlay} onClick={handleClose}>
      <div className={styles.modal.container} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modal.header}>
          <h3 className={styles.modal.title}>
            {editingAbsence ? 'Edit Absence Request' : 'Request Absence'}
          </h3>
          <button onClick={handleClose} className={styles.modal.closeButton} disabled={isSubmitting}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className={styles.modal.body}>
            {error && <div className={styles.modal.error}>{error}</div>}

            {/* Employee Select (for managers) */}
            {canAssignToOthers && employees && employees.length > 0 && (
              <div>
                <label className={styles.modal.label}>
                  Employee <span className="text-gray-400">(leave empty for yourself)</span>
                </label>
                <select
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                  className={styles.modal.select}
                  disabled={isSubmitting || !!editingAbsence}
                >
                  <option value="">Myself</option>
                  {employees.map((emp) => (
                    <option key={emp._id} value={emp._id}>
                      {emp.name} ({emp.email})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Absence Type */}
            <div>
              <label className={styles.modal.label}>
                Absence Type <span className={styles.modal.required}>*</span>
              </label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as AbsenceType)}
                className={styles.modal.select}
                disabled={isSubmitting}
                required
              >
                {ABSENCE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {absenceTypeConfig[t].label}
                  </option>
                ))}
              </select>
            </div>

            {/* Date Range */}
            <div className={styles.modal.dateRow}>
              <div>
                <label className={styles.modal.label}>
                  Start Date <span className={styles.modal.required}>*</span>
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className={styles.modal.input}
                  disabled={isSubmitting}
                  required
                />
              </div>
              <div>
                <label className={styles.modal.label}>
                  End Date <span className={styles.modal.required}>*</span>
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate}
                  className={styles.modal.input}
                  disabled={isSubmitting}
                  required
                />
              </div>
            </div>

            {/* Duration Preview */}
            {startDate && endDate && new Date(startDate) <= new Date(endDate) && (
              <div className="p-3 bg-gray-50 rounded-lg text-sm text-gray-600">
                Duration:{' '}
                <strong>
                  {Math.ceil(
                    (new Date(endDate).getTime() - new Date(startDate).getTime()) /
                      (1000 * 60 * 60 * 24)
                  ) + 1}{' '}
                  day(s)
                </strong>
              </div>
            )}

            {/* Reason */}
            <div>
              <label className={styles.modal.label}>Reason</label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className={styles.modal.textarea}
                rows={3}
                placeholder="Optional: Provide additional details..."
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
                  {editingAbsence ? 'Updating...' : 'Submitting...'}
                </>
              ) : editingAbsence ? (
                'Update Request'
              ) : (
                'Submit Request'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
