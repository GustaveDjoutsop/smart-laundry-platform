import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import MachineStatusGrid from './MachineStatusGrid';
import type { MachineStatus } from '@/types';

const meta: Meta<typeof MachineStatusGrid> = {
  title: 'Dashboard/MachineStatusGrid',
  component: MachineStatusGrid,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

// Sample machines data
const sampleMachines: MachineStatus[] = [
  { id: 'w1', type: 'washer', name: 'W1', status: 'available', totalCycles: 1520, cyclesThisMonth: 89, cyclesToday: 5, cyclesSinceMaintenance: 120, errorCount: 0, utilizationRate: 65, averageCyclesPerDay: 8 },
  { id: 'w2', type: 'washer', name: 'W2', status: 'in_use', currentProgram: 'Standard', timeRemaining: 25, totalCycles: 1480, cyclesThisMonth: 92, cyclesToday: 6, cyclesSinceMaintenance: 95, errorCount: 0, utilizationRate: 70, averageCyclesPerDay: 9 },
  { id: 'w3', type: 'washer', name: 'W3', status: 'available', totalCycles: 1350, cyclesThisMonth: 78, cyclesToday: 4, cyclesSinceMaintenance: 200, errorCount: 1, utilizationRate: 55, averageCyclesPerDay: 7 },
  { id: 'w4', type: 'washer', name: 'W4', status: 'in_use', currentProgram: 'Express', timeRemaining: 10, totalCycles: 1600, cyclesThisMonth: 95, cyclesToday: 7, cyclesSinceMaintenance: 50, errorCount: 0, utilizationRate: 72, averageCyclesPerDay: 9 },
  { id: 'w5', type: 'washer', name: 'W5', status: 'available', totalCycles: 1420, cyclesThisMonth: 85, cyclesToday: 5, cyclesSinceMaintenance: 180, errorCount: 0, utilizationRate: 62, averageCyclesPerDay: 8 },
  { id: 'w6', type: 'washer', name: 'W6', status: 'error', totalCycles: 980, cyclesThisMonth: 45, cyclesToday: 2, cyclesSinceMaintenance: 380, errorCount: 3, lastError: { code: 'E03', message: 'Door lock error', date: new Date() }, utilizationRate: 35, averageCyclesPerDay: 5 },
  { id: 'd1', type: 'dryer', name: 'D1', status: 'available', totalCycles: 1200, cyclesThisMonth: 72, cyclesToday: 4, cyclesSinceMaintenance: 100, errorCount: 0, utilizationRate: 58, averageCyclesPerDay: 7 },
  { id: 'd2', type: 'dryer', name: 'D2', status: 'available', totalCycles: 1150, cyclesThisMonth: 68, cyclesToday: 3, cyclesSinceMaintenance: 150, errorCount: 0, utilizationRate: 52, averageCyclesPerDay: 6 },
  { id: 'd3', type: 'dryer', name: 'D3', status: 'in_use', currentProgram: 'High Heat', timeRemaining: 15, totalCycles: 1100, cyclesThisMonth: 65, cyclesToday: 4, cyclesSinceMaintenance: 80, errorCount: 0, utilizationRate: 55, averageCyclesPerDay: 6 },
  { id: 'd4', type: 'dryer', name: 'D4', status: 'available', totalCycles: 1080, cyclesThisMonth: 62, cyclesToday: 3, cyclesSinceMaintenance: 220, errorCount: 1, utilizationRate: 48, averageCyclesPerDay: 5 },
];

export const Default: Story = {
  args: {
    machines: sampleMachines,
  },
};

export const AllAvailable: Story = {
  args: {
    machines: sampleMachines.map(m => ({ ...m, status: 'available' as const })),
  },
};

export const AllInUse: Story = {
  args: {
    machines: sampleMachines.map(m => ({
      ...m,
      status: 'in_use' as const,
      currentProgram: 'Standard',
      timeRemaining: Math.floor(Math.random() * 30) + 5,
    })),
  },
};

export const WithErrors: Story = {
  args: {
    machines: sampleMachines.map((m, i) => ({
      ...m,
      status: i % 3 === 0 ? 'error' as const : m.status,
      lastError: i % 3 === 0 ? { code: 'E0' + i, message: 'Machine error', date: new Date() } : m.lastError,
    })),
  },
};

export const MixedStatus: Story = {
  args: {
    machines: [
      { ...sampleMachines[0], status: 'available' as const },
      { ...sampleMachines[1], status: 'in_use' as const, currentProgram: 'Express', timeRemaining: 12 },
      { ...sampleMachines[2], status: 'completing' as const },
      { ...sampleMachines[3], status: 'error' as const, lastError: { code: 'E01', message: 'Drain blocked', date: new Date() } },
      { ...sampleMachines[4], status: 'maintenance' as const },
      { ...sampleMachines[5], status: 'offline' as const },
      { ...sampleMachines[6], status: 'available' as const },
      { ...sampleMachines[7], status: 'in_use' as const, currentProgram: 'High Heat', timeRemaining: 20 },
      { ...sampleMachines[8], status: 'available' as const },
      { ...sampleMachines[9], status: 'available' as const },
    ],
  },
};

export const SmallFleet: Story = {
  args: {
    machines: sampleMachines.slice(0, 4),
  },
};
