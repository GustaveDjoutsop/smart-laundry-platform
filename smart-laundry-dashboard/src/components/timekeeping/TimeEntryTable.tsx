'use client';

import { useState } from 'react';
import { Trash2, LogIn, LogOut, Loader2 } from 'lucide-react';
import { styles } from './styles';
import type { TimeEntryTableProps } from './types';

export default function TimeEntryTable({
  entries,
  isLoading,
  showEmployee = false,
  canManage = false,
  onDelete,
}: TimeEntryTableProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleDelete = async (id: string) => {
    if (!onDelete) return;
    setDeletingId(id);
    try {
      await onDelete(id);
    } finally {
      setDeletingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className={styles.entryTable.container}>
        <div className={styles.entryTable.header}>
          <h3 className={styles.entryTable.title}>Time Entries</h3>
        </div>
        <div className={styles.entryTable.tableContainer}>
          <table className={styles.entryTable.table}>
            <thead className={styles.entryTable.thead}>
              <tr>
                <th className={styles.entryTable.th}>Date/Time</th>
                {showEmployee && <th className={styles.entryTable.th}>Employee</th>}
                <th className={styles.entryTable.th}>Type</th>
                <th className={styles.entryTable.th}>Method</th>
                {canManage && <th className={styles.entryTable.th}>Actions</th>}
              </tr>
            </thead>
            <tbody className={styles.entryTable.tbody}>
              {[...Array(5)].map((_, i) => (
                <tr key={i}>
                  <td className={styles.entryTable.td}>
                    <div className={styles.entryTable.loadingState} style={{ width: '120px' }}></div>
                  </td>
                  {showEmployee && (
                    <td className={styles.entryTable.td}>
                      <div className={styles.entryTable.loadingState} style={{ width: '100px' }}></div>
                    </td>
                  )}
                  <td className={styles.entryTable.td}>
                    <div className={styles.entryTable.loadingState} style={{ width: '80px' }}></div>
                  </td>
                  <td className={styles.entryTable.td}>
                    <div className={styles.entryTable.loadingState} style={{ width: '80px' }}></div>
                  </td>
                  {canManage && (
                    <td className={styles.entryTable.td}>
                      <div className={styles.entryTable.loadingState} style={{ width: '40px' }}></div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className={styles.entryTable.container}>
        <div className={styles.entryTable.header}>
          <h3 className={styles.entryTable.title}>Time Entries</h3>
        </div>
        <div className={styles.entryTable.emptyState}>
          <p>No time entries found</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.entryTable.container}>
      <div className={styles.entryTable.header}>
        <h3 className={styles.entryTable.title}>Time Entries</h3>
      </div>
      <div className={styles.entryTable.tableContainer}>
        <table className={styles.entryTable.table}>
          <thead className={styles.entryTable.thead}>
            <tr>
              <th className={styles.entryTable.th}>Date/Time</th>
              {showEmployee && <th className={styles.entryTable.th}>Employee</th>}
              <th className={styles.entryTable.th}>Type</th>
              <th className={styles.entryTable.th}>Method</th>
              <th className={styles.entryTable.th}>Notes</th>
              {canManage && <th className={styles.entryTable.th}>Actions</th>}
            </tr>
          </thead>
          <tbody className={styles.entryTable.tbody}>
            {entries.map((entry) => (
              <tr key={entry._id} className={styles.entryTable.tr}>
                <td className={styles.entryTable.td}>
                  <div className={styles.entryTable.tdText}>{formatDate(entry.timestamp)}</div>
                  <div className={styles.entryTable.tdSubtext}>{formatTime(entry.timestamp)}</div>
                </td>
                {showEmployee && (
                  <td className={styles.entryTable.td}>
                    <div className={styles.entryTable.tdText}>{entry.employee.name}</div>
                    <div className={styles.entryTable.tdSubtext}>{entry.employee.email}</div>
                  </td>
                )}
                <td className={styles.entryTable.td}>
                  <span
                    className={`${styles.entryTable.badge.base} ${
                      entry.type === 'clock_in'
                        ? styles.entryTable.badge.clockIn
                        : styles.entryTable.badge.clockOut
                    }`}
                  >
                    {entry.type === 'clock_in' ? (
                      <>
                        <LogIn className="w-3 h-3 mr-1" />
                        Clock In
                      </>
                    ) : (
                      <>
                        <LogOut className="w-3 h-3 mr-1" />
                        Clock Out
                      </>
                    )}
                  </span>
                </td>
                <td className={styles.entryTable.td}>
                  <span
                    className={`${styles.entryTable.badge.base} ${
                      entry.method === 'automatic'
                        ? styles.entryTable.badge.automatic
                        : styles.entryTable.badge.manual
                    }`}
                  >
                    {entry.method}
                  </span>
                </td>
                <td className={styles.entryTable.td}>
                  <span className={styles.entryTable.tdSubtext}>
                    {entry.notes || '-'}
                  </span>
                </td>
                {canManage && (
                  <td className={styles.entryTable.td}>
                    <button
                      onClick={() => handleDelete(entry._id)}
                      disabled={deletingId === entry._id}
                      className={styles.entryTable.deleteButton}
                    >
                      {deletingId === entry._id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
