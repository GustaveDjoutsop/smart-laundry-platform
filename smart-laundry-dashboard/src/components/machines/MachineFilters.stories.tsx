import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import MachineFilters from './MachineFilters';

const meta: Meta<typeof MachineFilters> = {
  title: 'Machines/MachineFilters',
  component: MachineFilters,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const TypeOnly: Story = {
  args: {
    typeFilter: 'all',
    onTypeFilterChange: () => {},
  },
};

export const WashersSelected: Story = {
  args: {
    typeFilter: 'washer',
    onTypeFilterChange: () => {},
  },
};

export const DryersSelected: Story = {
  args: {
    typeFilter: 'dryer',
    onTypeFilterChange: () => {},
  },
};

export const WithStatusFilter: Story = {
  args: {
    typeFilter: 'all',
    onTypeFilterChange: () => {},
    statusFilter: 'all',
    onStatusFilterChange: () => {},
    showStatusFilter: true,
  },
};

export const StatusAvailable: Story = {
  args: {
    typeFilter: 'washer',
    onTypeFilterChange: () => {},
    statusFilter: 'available',
    onStatusFilterChange: () => {},
    showStatusFilter: true,
  },
};

export const StatusError: Story = {
  args: {
    typeFilter: 'all',
    onTypeFilterChange: () => {},
    statusFilter: 'error',
    onStatusFilterChange: () => {},
    showStatusFilter: true,
  },
};

// Interactive example
const InteractiveFilters = () => {
  const [typeFilter, setTypeFilter] = useState<'all' | 'washer' | 'dryer'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'available' | 'in_use' | 'error' | 'maintenance'>('all');

  return (
    <div>
      <MachineFilters
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        showStatusFilter={true}
      />
      <div className="mt-4 p-4 bg-gray-100 rounded-lg">
        <p className="text-sm text-gray-600">
          Type: <span className="font-medium">{typeFilter}</span>
        </p>
        <p className="text-sm text-gray-600">
          Status: <span className="font-medium">{statusFilter}</span>
        </p>
      </div>
    </div>
  );
};

export const Interactive: Story = {
  render: () => <InteractiveFilters />,
};
