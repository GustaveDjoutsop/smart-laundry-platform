'use client';

import { formatCurrency, formatDate, cn } from '@/lib/utils';
import { styles, providerColors, statusColors } from './styles';
import type { RecentTransactionsProps } from './types';

export default function RecentTransactions({ transactions }: RecentTransactionsProps) {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.title}>Recent Transactions</h3>
        <a href="/dashboard/transactions" className={styles.viewAllLink}>
          View all
        </a>
      </div>

      <div className={styles.list}>
        {transactions.length === 0 ? (
          <p className={styles.emptyState}>No recent transactions</p>
        ) : (
          transactions.map((txn) => (
            <div key={txn.id} className={styles.item.container}>
              <div className={styles.item.content}>
                <div className={styles.item.nameRow}>
                  <span className={styles.item.machineName}>{txn.machineName}</span>
                  <span
                    className={cn(
                      styles.badge,
                      providerColors[txn.provider.toLowerCase()] || 'bg-gray-100 text-gray-700'
                    )}
                  >
                    {txn.provider}
                  </span>
                </div>
                <div className={styles.item.detailsRow}>
                  <span className={styles.item.program}>{txn.program}</span>
                  <span className={styles.item.separator}>•</span>
                  <span className={styles.item.time}>
                    {formatDate(txn.date, { timeStyle: 'short', dateStyle: undefined })}
                  </span>
                </div>
              </div>
              <div className={styles.item.rightColumn}>
                <p className={styles.item.amount}>{formatCurrency(txn.amount)}</p>
                <span className={cn(styles.item.status, statusColors[txn.status])}>
                  {txn.status}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
