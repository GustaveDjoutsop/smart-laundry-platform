'use client';

import { useState } from 'react';
import { Check, X, Edit2, Trash2, Loader2 } from 'lucide-react';
import { styles } from './styles';
import { absenceTypeConfig, absenceStatusConfig } from './types';
import type { AbsenceTableProps, Absence } from './types';

export default function AbsenceTable({
  absences,
  isLoading,
  showEmployee = false,
  canApprove = false,
  currentUserId,
  onApprove,
  onReject,
  onDelete,
  onEdit,
}: AbsenceTableProps) {
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectModalAbsence, setRejectModalAbsence] = useState<Absence | null>(null);
  const [rejectNotes, setRejectNotes] = useState('');

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const handleApprove = async (id: string) => {
    if (!onApprove) return;
    setProcessingId(id);
    try {
      await onApprove(id);
    } finally {
      setProcessingId(null);
    }
  };

  const handleRejectClick = (absence: Absence) => {
    setRejectModalAbsence(absence);
    setRejectNotes('');
  };

  const handleRejectConfirm = async () => {
    if (!onReject || !rejectModalAbsence || !rejectNotes.trim()) return;
    setProcessingId(rejectModalAbsence._id);
    try {
      await onReject(rejectModalAbsence._id, rejectNotes.trim());
      setRejectModalAbsence(null);
      setRejectNotes('');
    } finally {
      setProcessingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!onDelete) return;
    setProcessingId(id);
    try {
      await onDelete(id);
    } finally {
      setProcessingId(null);
    }
  };

  const isOwner = (absence: Absence) => {
    return currentUserId && absence.employee._id === currentUserId;
  };

  const canEditOrDelete = (absence: Absence) => {
    // Can edit/delete if owner and pending, or if manager
    return (isOwner(absence) && absence.status === 'pending') || canApprove;
  };

  if (isLoading) {
    return (
      <div className={styles.table.container}>
        <div className={styles.table.header}>
          <h3 className={styles.table.title}>Absences</h3>
        </div>
        <div className={styles.table.tableContainer}>
          <table className={styles.table.table}>
            <thead className={styles.table.thead}>
              <tr>
                {showEmployee && <th className={styles.table.th}>Employee</th>}
                <th className={styles.table.th}>Type</th>
                <th className={styles.table.th}>Dates</th>
                <th className={styles.table.th}>Duration</th>
                <th className={styles.table.th}>Status</th>
                <th className={styles.table.th}>Actions</th>
              </tr>
            </thead>
            <tbody className={styles.table.tbody}>
              {[...Array(5)].map((_, i) => (
                <tr key={i}>
                  {showEmployee && (
                    <td className={styles.table.td}>
                      <div className={styles.table.loadingState} style={{ width: '100px' }}></div>
                    </td>
                  )}
                  <td className={styles.table.td}>
                    <div className={styles.table.loadingState} style={{ width: '80px' }}></div>
                  </td>
                  <td className={styles.table.td}>
                    <div className={styles.table.loadingState} style={{ width: '150px' }}></div>
                  </td>
                  <td className={styles.table.td}>
                    <div className={styles.table.loadingState} style={{ width: '60px' }}></div>
                  </td>
                  <td className={styles.table.td}>
                    <div className={styles.table.loadingState} style={{ width: '80px' }}></div>
                  </td>
                  <td className={styles.table.td}>
                    <div className={styles.table.loadingState} style={{ width: '80px' }}></div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (absences.length === 0) {
    return (
      <div className={styles.table.container}>
        <div className={styles.table.header}>
          <h3 className={styles.table.title}>Absences</h3>
        </div>
        <div className={styles.table.emptyState}>
          <p>No absences found</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={styles.table.container}>
        <div className={styles.table.header}>
          <h3 className={styles.table.title}>Absences</h3>
        </div>
        <div className={styles.table.tableContainer}>
          <table className={styles.table.table}>
            <thead className={styles.table.thead}>
              <tr>
                {showEmployee && <th className={styles.table.th}>Employee</th>}
                <th className={styles.table.th}>Type</th>
                <th className={styles.table.th}>Dates</th>
                <th className={styles.table.th}>Duration</th>
                <th className={styles.table.th}>Status</th>
                <th className={styles.table.th}>Reason</th>
                <th className={styles.table.th}>Actions</th>
              </tr>
            </thead>
            <tbody className={styles.table.tbody}>
              {absences.map((absence) => {
                const typeConfig = absenceTypeConfig[absence.type];
                const statusConfig = absenceStatusConfig[absence.status];
                const isProcessing = processingId === absence._id;

                return (
                  <tr key={absence._id} className={styles.table.tr}>
                    {showEmployee && (
                      <td className={styles.table.td}>
                        <div className={styles.table.tdText}>{absence.employee.name}</div>
                        <div className={styles.table.tdSubtext}>{absence.employee.email}</div>
                      </td>
                    )}
                    <td className={styles.table.td}>
                      <span
                        className={`${styles.table.badge.base} ${typeConfig.bgColor} ${typeConfig.color}`}
                      >
                        {typeConfig.label}
                      </span>
                    </td>
                    <td className={styles.table.td}>
                      <div className={styles.table.tdText}>
                        {formatDate(absence.startDate)} - {formatDate(absence.endDate)}
                      </div>
                    </td>
                    <td className={styles.table.td}>
                      <span className={styles.table.tdText}>
                        {absence.durationDays} day{absence.durationDays !== 1 ? 's' : ''}
                      </span>
                    </td>
                    <td className={styles.table.td}>
                      <span
                        className={`${styles.table.badge.base} ${statusConfig.bgColor} ${statusConfig.color}`}
                      >
                        {statusConfig.label}
                      </span>
                    </td>
                    <td className={styles.table.td}>
                      <span className={styles.table.tdSubtext}>
                        {absence.reason || '-'}
                      </span>
                    </td>
                    <td className={styles.table.td}>
                      <div className={styles.actions.container}>
                        {/* Approve/Reject buttons for pending absences */}
                        {canApprove && absence.status === 'pending' && (
                          <>
                            <button
                              onClick={() => handleApprove(absence._id)}
                              disabled={isProcessing}
                              className={`${styles.table.actionButton} ${styles.actions.approveButton}`}
                              title="Approve"
                            >
                              {isProcessing ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Check className="w-4 h-4" />
                              )}
                            </button>
                            <button
                              onClick={() => handleRejectClick(absence)}
                              disabled={isProcessing}
                              className={`${styles.table.actionButton} ${styles.actions.rejectButton}`}
                              title="Reject"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </>
                        )}

                        {/* Edit button */}
                        {canEditOrDelete(absence) && onEdit && absence.status === 'pending' && (
                          <button
                            onClick={() => onEdit(absence)}
                            disabled={isProcessing}
                            className={`${styles.table.actionButton} ${styles.actions.editButton}`}
                            title="Edit"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                        )}

                        {/* Delete button */}
                        {canEditOrDelete(absence) && onDelete && (
                          <button
                            onClick={() => handleDelete(absence._id)}
                            disabled={isProcessing}
                            className={`${styles.table.actionButton} ${styles.actions.deleteButton}`}
                            title="Delete"
                          >
                            {isProcessing ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reject Modal */}
      {rejectModalAbsence && (
        <div className={styles.rejectModal.overlay} onClick={() => setRejectModalAbsence(null)}>
          <div className={styles.rejectModal.container} onClick={(e) => e.stopPropagation()}>
            <div className={styles.rejectModal.header}>
              <h3 className={styles.rejectModal.title}>Reject Absence Request</h3>
            </div>
            <div className={styles.rejectModal.body}>
              <p className="text-sm text-gray-600 mb-4">
                Please provide a reason for rejecting this absence request from{' '}
                <strong>{rejectModalAbsence.employee.name}</strong>.
              </p>
              <textarea
                value={rejectNotes}
                onChange={(e) => setRejectNotes(e.target.value)}
                placeholder="Rejection reason (required)..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-danger-500 focus:border-danger-500"
                rows={3}
              />
            </div>
            <div className={styles.rejectModal.footer}>
              <button
                onClick={() => setRejectModalAbsence(null)}
                className={styles.rejectModal.cancelButton}
              >
                Cancel
              </button>
              <button
                onClick={handleRejectConfirm}
                disabled={!rejectNotes.trim() || processingId === rejectModalAbsence._id}
                className={styles.rejectModal.rejectButton}
              >
                {processingId === rejectModalAbsence._id ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin inline" />
                    Rejecting...
                  </>
                ) : (
                  'Reject'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
