import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import MachineCard from './MachineCard';
import type { MachineStatus } from '@/types';

const meta: Meta<typeof MachineCard> = {
  title: 'Machines/MachineCard',
  component: MachineCard,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    onViewHistory: { action: 'viewHistory' },
    onMaintenance: { action: 'maintenance' },
  },
  decorators: [
    (Story) => (
      <div className="w-[380px]">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

const baseMachine: MachineStatus = {
  id: 'w1',
  type: 'washer',
  name: 'Washer 1',
  status: 'available',
  totalCycles: 1520,
  cyclesThisMonth: 89,
  cyclesToday: 5,
  cyclesSinceMaintenance: 120,
  errorCount: 0,
  utilizationRate: 65,
  averageCyclesPerDay: 8,
};

// Status variants
export const Available: Story = {
  args: {
    machine: {
      ...baseMachine,
      status: 'available',
    },
  },
};

export const InUse: Story = {
  args: {
    machine: {
      ...baseMachine,
      status: 'in_use',
      currentProgram: 'Standard',
      timeRemaining: 25,
    },
  },
};

export const InUseAlmostDone: Story = {
  args: {
    machine: {
      ...baseMachine,
      status: 'in_use',
      currentProgram: 'Express',
      timeRemaining: 5,
    },
  },
};

export const Completing: Story = {
  args: {
    machine: {
      ...baseMachine,
      status: 'completing',
      currentProgram: 'Intensif',
    },
  },
};

export const Error: Story = {
  args: {
    machine: {
      ...baseMachine,
      status: 'error',
      errorCount: 3,
      lastError: {
        code: 'E03',
        message: 'Door lock error',
        date: new Date(),
      },
    },
  },
};

export const Maintenance: Story = {
  args: {
    machine: {
      ...baseMachine,
      status: 'maintenance',
    },
  },
};

export const Offline: Story = {
  args: {
    machine: {
      ...baseMachine,
      status: 'offline',
    },
  },
};

// Machine types
export const Washer: Story = {
  args: {
    machine: {
      ...baseMachine,
      type: 'washer',
      name: 'Washer 2',
      status: 'in_use',
      currentProgram: 'Standard',
      timeRemaining: 30,
    },
  },
};

export const Dryer: Story = {
  args: {
    machine: {
      ...baseMachine,
      id: 'd1',
      type: 'dryer',
      name: 'Dryer 1',
      status: 'in_use',
      currentProgram: 'High Heat',
      timeRemaining: 20,
    },
  },
};

// Maintenance warnings
export const NeedsMaintenanceSoon: Story = {
  args: {
    machine: {
      ...baseMachine,
      cyclesSinceMaintenance: 320,
    },
  },
};

export const NeedsMaintenanceUrgent: Story = {
  args: {
    machine: {
      ...baseMachine,
      cyclesSinceMaintenance: 450,
    },
  },
};

// High utilization
export const HighUtilization: Story = {
  args: {
    machine: {
      ...baseMachine,
      utilizationRate: 92,
      cyclesThisMonth: 145,
      totalCycles: 5200,
    },
  },
};

// All statuses grid
export const AllStatuses: Story = {
  decorators: [
    (Story) => (
      <div className="grid grid-cols-2 gap-4 max-w-3xl">
        <Story />
      </div>
    ),
  ],
  render: () => (
    <>
      <MachineCard machine={{ ...baseMachine, status: 'available' }} />
      <MachineCard
        machine={{
          ...baseMachine,
          status: 'in_use',
          currentProgram: 'Standard',
          timeRemaining: 25,
        }}
      />
      <MachineCard machine={{ ...baseMachine, status: 'completing' }} />
      <MachineCard
        machine={{
          ...baseMachine,
          status: 'error',
          lastError: { code: 'E03', message: 'Door lock error', date: new Date() },
        }}
      />
      <MachineCard machine={{ ...baseMachine, status: 'maintenance' }} />
      <MachineCard machine={{ ...baseMachine, status: 'offline' }} />
    </>
  ),
};
