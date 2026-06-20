import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import RevenueChart from './RevenueChart';

const meta: Meta<typeof RevenueChart> = {
  title: 'Dashboard/RevenueChart',
  component: RevenueChart,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

const weeklyData = [
  { day: 'Mon', revenue: 45000 },
  { day: 'Tue', revenue: 52000 },
  { day: 'Wed', revenue: 48000 },
  { day: 'Thu', revenue: 55000 },
  { day: 'Fri', revenue: 60000 },
  { day: 'Sat', revenue: 70000 },
  { day: 'Sun', revenue: 35000 },
];

export const Default: Story = {
  args: {
    data: weeklyData,
  },
};

export const WithTarget: Story = {
  args: {
    data: weeklyData,
    target: 500000,
  },
};

export const TargetExceeded: Story = {
  args: {
    data: weeklyData.map(d => ({ ...d, revenue: d.revenue * 2 })),
    target: 500000,
  },
};

export const LowRevenue: Story = {
  args: {
    data: weeklyData.map(d => ({ ...d, revenue: d.revenue * 0.3 })),
    target: 500000,
  },
};

export const HighVolatility: Story = {
  args: {
    data: [
      { day: 'Mon', revenue: 20000 },
      { day: 'Tue', revenue: 80000 },
      { day: 'Wed', revenue: 30000 },
      { day: 'Thu', revenue: 90000 },
      { day: 'Fri', revenue: 25000 },
      { day: 'Sat', revenue: 100000 },
      { day: 'Sun', revenue: 15000 },
    ],
    target: 400000,
  },
};

export const SteadyGrowth: Story = {
  args: {
    data: [
      { day: 'Mon', revenue: 30000 },
      { day: 'Tue', revenue: 35000 },
      { day: 'Wed', revenue: 42000 },
      { day: 'Thu', revenue: 50000 },
      { day: 'Fri', revenue: 58000 },
      { day: 'Sat', revenue: 68000 },
      { day: 'Sun', revenue: 75000 },
    ],
    target: 400000,
  },
};

export const WeekendPeak: Story = {
  args: {
    data: [
      { day: 'Mon', revenue: 25000 },
      { day: 'Tue', revenue: 28000 },
      { day: 'Wed', revenue: 30000 },
      { day: 'Thu', revenue: 32000 },
      { day: 'Fri', revenue: 55000 },
      { day: 'Sat', revenue: 85000 },
      { day: 'Sun', revenue: 45000 },
    ],
    target: 350000,
  },
};
