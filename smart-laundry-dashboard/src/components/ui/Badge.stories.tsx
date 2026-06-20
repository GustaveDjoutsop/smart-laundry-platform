import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Badge } from './Badge';

const meta: Meta<typeof Badge> = {
  title: 'UI/Badge',
  component: Badge,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'primary', 'secondary', 'success', 'warning', 'danger', 'info', 'mtn', 'orange', 'wave', 'campay', 'nkwa'],
    },
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
    },
    dot: {
      control: 'boolean',
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

// Basic variants
export const Default: Story = {
  args: {
    children: 'Default',
    variant: 'default',
  },
};

export const Primary: Story = {
  args: {
    children: 'Primary',
    variant: 'primary',
  },
};

export const Success: Story = {
  args: {
    children: 'Completed',
    variant: 'success',
  },
};

export const Warning: Story = {
  args: {
    children: 'Pending',
    variant: 'warning',
  },
};

export const Danger: Story = {
  args: {
    children: 'Failed',
    variant: 'danger',
  },
};

export const Info: Story = {
  args: {
    children: 'Info',
    variant: 'info',
  },
};

// Payment providers
export const MTN: Story = {
  args: {
    children: 'MTN',
    variant: 'mtn',
  },
};

export const Orange: Story = {
  args: {
    children: 'Orange',
    variant: 'orange',
  },
};

export const Wave: Story = {
  args: {
    children: 'Wave',
    variant: 'wave',
  },
};

export const CamPay: Story = {
  args: {
    children: 'CamPay',
    variant: 'campay',
  },
};

export const Nkwa: Story = {
  args: {
    children: 'Nkwa',
    variant: 'nkwa',
  },
};

// Sizes
export const Small: Story = {
  args: {
    children: 'Small',
    size: 'sm',
  },
};

export const Medium: Story = {
  args: {
    children: 'Medium',
    size: 'md',
  },
};

export const Large: Story = {
  args: {
    children: 'Large',
    size: 'lg',
  },
};

// With dot indicator
export const WithDot: Story = {
  args: {
    children: 'Active',
    variant: 'success',
    dot: true,
  },
};

export const PendingWithDot: Story = {
  args: {
    children: 'Pending',
    variant: 'warning',
    dot: true,
  },
};

export const ErrorWithDot: Story = {
  args: {
    children: 'Error',
    variant: 'danger',
    dot: true,
  },
};

// Status badges showcase
export const StatusBadges: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge variant="success" dot>Available</Badge>
      <Badge variant="primary" dot>In Use</Badge>
      <Badge variant="warning" dot>Pending</Badge>
      <Badge variant="danger" dot>Error</Badge>
      <Badge variant="secondary" dot>Offline</Badge>
    </div>
  ),
};

// Payment provider badges showcase
export const PaymentProviders: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge variant="mtn">MTN</Badge>
      <Badge variant="orange">Orange</Badge>
      <Badge variant="wave">Wave</Badge>
      <Badge variant="campay">CamPay</Badge>
      <Badge variant="nkwa">Nkwa</Badge>
    </div>
  ),
};

// All variants
export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge variant="default">Default</Badge>
      <Badge variant="primary">Primary</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="success">Success</Badge>
      <Badge variant="warning">Warning</Badge>
      <Badge variant="danger">Danger</Badge>
      <Badge variant="info">Info</Badge>
    </div>
  ),
};

// All sizes
export const AllSizes: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Badge size="sm">Small</Badge>
      <Badge size="md">Medium</Badge>
      <Badge size="lg">Large</Badge>
    </div>
  ),
};
