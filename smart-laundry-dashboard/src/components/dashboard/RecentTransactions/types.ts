export type TransactionStatus = 'completed' | 'pending' | 'failed';

export interface DisplayTransaction {
  id: string;
  date: Date;
  machineId: string;
  machineName: string;
  program: string;
  amount: number;
  provider: string;
  status: TransactionStatus;
}

export interface RecentTransactionsProps {
  transactions: DisplayTransaction[];
}
