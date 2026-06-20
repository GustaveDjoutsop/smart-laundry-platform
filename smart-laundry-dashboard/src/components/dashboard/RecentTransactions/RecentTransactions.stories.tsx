import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import RecentTransactions from './RecentTransactions';
import type { DisplayTransaction } from './types';

const meta: Meta<typeof RecentTransactions> = {
  title: 'Dashboard/RecentTransactions',
  component: RecentTransactions,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="max-w-lg">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

const sampleTransactions: DisplayTransaction[] = [
  { id: 't1', date: new Date(), machineId: 'w2', machineName: 'Washer 2', program: 'Standard', amount: 3000, provider: 'MTN', status: 'completed' },
  { id: 't2', date: new Date(Date.now() - 15 * 60000), machineId: 'w4', machineName: 'Washer 4', program: 'Express', amount: 2500, provider: 'Orange', status: 'completed' },
  { id: 't3', date: new Date(Date.now() - 30 * 60000), machineId: 'd3', machineName: 'Dryer 3', program: 'High Heat', amount: 2000, provider: 'Wave', status: 'completed' },
  { id: 't4', date: new Date(Date.now() - 45 * 60000), machineId: 'w1', machineName: 'Washer 1', program: 'Intensif', amount: 4000, provider: 'CamPay', status: 'completed' },
  { id: 't5', date: new Date(Date.now() - 60 * 60000), machineId: 'w3', machineName: 'Washer 3', program: 'Standard', amount: 3000, provider: 'Nkwa', status: 'completed' },
];

export const Default: Story = {
  args: {
    transactions: sampleTransactions,
  },
};

export const Empty: Story = {
  args: {
    transactions: [],
  },
};

export const WithPending: Story = {
  args: {
    transactions: [
      { ...sampleTransactions[0], status: 'pending' as const },
      ...sampleTransactions.slice(1),
    ],
  },
};

export const WithFailed: Story = {
  args: {
    transactions: [
      { ...sampleTransactions[0], status: 'failed' as const },
      { ...sampleTransactions[1], status: 'pending' as const },
      ...sampleTransactions.slice(2),
    ],
  },
};

export const AllProviders: Story = {
  args: {
    transactions: [
      { ...sampleTransactions[0], provider: 'MTN' },
      { ...sampleTransactions[1], provider: 'Orange' },
      { ...sampleTransactions[2], provider: 'Wave' },
      { ...sampleTransactions[3], provider: 'CamPay' },
      { ...sampleTransactions[4], provider: 'Nkwa' },
    ],
  },
};

export const SingleTransaction: Story = {
  args: {
    transactions: [sampleTransactions[0]],
  },
};

export const ManyTransactions: Story = {
  args: {
    transactions: Array.from({ length: 10 }, (_, i) => ({
      ...sampleTransactions[i % 5],
      id: `t${i + 1}`,
      date: new Date(Date.now() - i * 10 * 60000),
    })),
  },
};
