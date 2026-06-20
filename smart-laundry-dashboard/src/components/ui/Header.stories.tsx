import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import Header from './Header';

const meta: Meta<typeof Header> = {
  title: 'UI/Header',
  component: Header,
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="bg-gray-100 min-h-[400px]">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: 'Dashboard',
  },
};

export const WithAlerts: Story = {
  args: {
    title: 'Dashboard',
    alertsCount: 3,
  },
};

export const ManyAlerts: Story = {
  args: {
    title: 'Maintenance',
    alertsCount: 15,
  },
};

export const SettingsPage: Story = {
  args: {
    title: 'Settings',
  },
};

export const NoNotifications: Story = {
  args: {
    title: 'Reports',
    notifications: [],
  },
};

export const AllUnread: Story = {
  args: {
    title: 'Dashboard',
    notifications: [
      {
        id: '1',
        type: 'error' as const,
        title: 'Machine Error',
        message: 'Washer 6 - Door lock error',
        time: new Date(Date.now() - 5 * 60000),
        read: false,
      },
      {
        id: '2',
        type: 'warning' as const,
        title: 'Maintenance Due',
        message: 'Washer 5 needs maintenance',
        time: new Date(Date.now() - 30 * 60000),
        read: false,
      },
      {
        id: '3',
        type: 'success' as const,
        title: 'Payment Received',
        message: '3,000 XAF from MTN',
        time: new Date(Date.now() - 60 * 60000),
        read: false,
      },
    ],
  },
};

export const MixedNotifications: Story = {
  args: {
    title: 'Dashboard',
    notifications: [
      {
        id: '1',
        type: 'error' as const,
        title: 'Critical Error',
        message: 'Washer 6 - Motor failure detected',
        time: new Date(Date.now() - 2 * 60000),
        read: false,
      },
      {
        id: '2',
        type: 'warning' as const,
        title: 'Maintenance Required',
        message: 'Dryer 4 - 320 cycles since maintenance',
        time: new Date(Date.now() - 15 * 60000),
        read: false,
      },
      {
        id: '3',
        type: 'success' as const,
        title: 'Daily Target Reached',
        message: 'Congratulations! Today\'s revenue target met',
        time: new Date(Date.now() - 2 * 60 * 60000),
        read: true,
      },
      {
        id: '4',
        type: 'info' as const,
        title: 'Weekly Report Ready',
        message: 'Your weekly performance report is available',
        time: new Date(Date.now() - 24 * 60 * 60000),
        read: true,
      },
    ],
  },
};

// Interactive demo showing dropdowns
export const Interactive: Story = {
  args: {
    title: 'Dashboard',
    alertsCount: 2,
  },
  parameters: {
    docs: {
      description: {
        story: 'Click on the bell icon to see notifications, and the user avatar to see the user menu.',
      },
    },
  },
};
