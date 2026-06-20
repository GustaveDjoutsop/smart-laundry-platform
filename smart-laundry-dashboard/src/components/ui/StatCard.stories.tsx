import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import StatCard from './StatCard';
import {
  Banknote,
  WashingMachine,
  AlertTriangle,
  TrendingUp,
  Users,
  Coffee,
  Wrench,
  Clock,
} from 'lucide-react';

const meta: Meta<typeof StatCard> = {
  title: 'Dashboard/StatCard',
  component: StatCard,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[280px]">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

// Revenue card
export const Revenue: Story = {
  args: {
    title: "Today's Revenue",
    value: '45,000 XAF',
    icon: Banknote,
    iconColor: 'text-success-600 bg-success-50',
    trend: { value: 12, isPositive: true },
  },
};

// Active machines
export const ActiveMachines: Story = {
  args: {
    title: 'Active Machines',
    value: 3,
    subtitle: 'of 10 total',
    icon: WashingMachine,
    iconColor: 'text-primary-600 bg-primary-50',
  },
};

// Alerts
export const Alerts: Story = {
  args: {
    title: 'Alerts',
    value: 2,
    subtitle: 'issues to resolve',
    icon: AlertTriangle,
    iconColor: 'text-warning-600 bg-warning-50',
  },
};

// Month revenue
export const MonthRevenue: Story = {
  args: {
    title: 'Month Revenue',
    value: '1,250,000 XAF',
    icon: TrendingUp,
    iconColor: 'text-primary-600 bg-primary-50',
    trend: { value: 8, isPositive: true },
  },
};

// Negative trend
export const NegativeTrend: Story = {
  args: {
    title: 'Weekly Visitors',
    value: '245',
    icon: Users,
    iconColor: 'text-blue-600 bg-blue-50',
    trend: { value: 5, isPositive: false },
  },
};

// Cafe sales
export const CafeSales: Story = {
  args: {
    title: 'Cafe Sales',
    value: '32,500 XAF',
    icon: Coffee,
    iconColor: 'text-amber-600 bg-amber-50',
    trend: { value: 15, isPositive: true },
  },
};

// Maintenance
export const MaintenanceDue: Story = {
  args: {
    title: 'Maintenance Due',
    value: 3,
    subtitle: 'machines need attention',
    icon: Wrench,
    iconColor: 'text-danger-600 bg-danger-50',
  },
};

// Average wait time
export const WaitTime: Story = {
  args: {
    title: 'Avg Wait Time',
    value: '12 min',
    icon: Clock,
    iconColor: 'text-gray-600 bg-gray-100',
  },
};

// Dashboard stats grid
export const DashboardGrid: Story = {
  decorators: [
    (Story) => (
      <div className="w-full max-w-4xl">
        <Story />
      </div>
    ),
  ],
  render: () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard
        title="Today's Revenue"
        value="45,000 XAF"
        icon={Banknote}
        iconColor="text-success-600 bg-success-50"
        trend={{ value: 12, isPositive: true }}
      />
      <StatCard
        title="Active Machines"
        value={3}
        subtitle="of 10 total"
        icon={WashingMachine}
        iconColor="text-primary-600 bg-primary-50"
      />
      <StatCard
        title="Alerts"
        value={2}
        subtitle="issues to resolve"
        icon={AlertTriangle}
        iconColor="text-warning-600 bg-warning-50"
      />
      <StatCard
        title="Month Revenue"
        value="1,250,000 XAF"
        icon={TrendingUp}
        iconColor="text-primary-600 bg-primary-50"
        trend={{ value: 8, isPositive: true }}
      />
    </div>
  ),
};

// All icon colors
export const IconColors: Story = {
  decorators: [
    (Story) => (
      <div className="w-full max-w-2xl">
        <Story />
      </div>
    ),
  ],
  render: () => (
    <div className="grid grid-cols-2 gap-4">
      <StatCard
        title="Primary"
        value="100"
        icon={TrendingUp}
        iconColor="text-primary-600 bg-primary-50"
      />
      <StatCard
        title="Success"
        value="100"
        icon={TrendingUp}
        iconColor="text-success-600 bg-success-50"
      />
      <StatCard
        title="Warning"
        value="100"
        icon={TrendingUp}
        iconColor="text-warning-600 bg-warning-50"
      />
      <StatCard
        title="Danger"
        value="100"
        icon={TrendingUp}
        iconColor="text-danger-600 bg-danger-50"
      />
    </div>
  ),
};
