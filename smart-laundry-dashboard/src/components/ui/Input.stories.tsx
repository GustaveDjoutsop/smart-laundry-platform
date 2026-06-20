import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Input } from './Input';
import { Search, Mail, Lock, Eye, EyeOff, Phone } from 'lucide-react';

const meta: Meta<typeof Input> = {
  title: 'UI/Input',
  component: Input,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'error', 'success'],
    },
    inputSize: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
    },
    disabled: {
      control: 'boolean',
    },
  },
  decorators: [
    (Story) => (
      <div className="w-[320px]">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

// Basic
export const Default: Story = {
  args: {
    placeholder: 'Enter text...',
  },
};

export const WithLabel: Story = {
  args: {
    label: 'Email Address',
    placeholder: 'you@example.com',
    type: 'email',
  },
};

export const WithHint: Story = {
  args: {
    label: 'Password',
    type: 'password',
    placeholder: 'Enter your password',
    hint: 'Must be at least 8 characters',
  },
};

export const WithError: Story = {
  args: {
    label: 'Email Address',
    placeholder: 'you@example.com',
    type: 'email',
    error: 'Please enter a valid email address',
    defaultValue: 'invalid-email',
  },
};

export const Success: Story = {
  args: {
    label: 'Username',
    placeholder: 'Choose a username',
    variant: 'success',
    defaultValue: 'available_username',
  },
};

export const Disabled: Story = {
  args: {
    label: 'Disabled Input',
    placeholder: 'Cannot edit',
    disabled: true,
    defaultValue: 'Disabled value',
  },
};

// Sizes
export const Small: Story = {
  args: {
    placeholder: 'Small input',
    inputSize: 'sm',
  },
};

export const Medium: Story = {
  args: {
    placeholder: 'Medium input',
    inputSize: 'md',
  },
};

export const Large: Story = {
  args: {
    placeholder: 'Large input',
    inputSize: 'lg',
  },
};

// With icons
export const WithLeftIcon: Story = {
  args: {
    placeholder: 'Search...',
    leftIcon: <Search className="w-4 h-4" />,
  },
};

export const WithRightIcon: Story = {
  args: {
    label: 'Password',
    type: 'password',
    placeholder: 'Enter password',
    rightIcon: <Eye className="w-4 h-4 cursor-pointer" />,
  },
};

export const EmailInput: Story = {
  args: {
    label: 'Email',
    type: 'email',
    placeholder: 'you@example.com',
    leftIcon: <Mail className="w-4 h-4" />,
  },
};

export const PasswordInput: Story = {
  args: {
    label: 'Password',
    type: 'password',
    placeholder: 'Enter password',
    leftIcon: <Lock className="w-4 h-4" />,
    rightIcon: <Eye className="w-4 h-4 cursor-pointer" />,
  },
};

export const PhoneInput: Story = {
  args: {
    label: 'Phone Number',
    type: 'tel',
    placeholder: '+237 6XX XXX XXX',
    leftIcon: <Phone className="w-4 h-4" />,
  },
};

export const SearchInput: Story = {
  args: {
    placeholder: 'Search transactions, machines...',
    leftIcon: <Search className="w-4 h-4" />,
    inputSize: 'lg',
  },
};

// Input types
export const NumberInput: Story = {
  args: {
    label: 'Amount (XAF)',
    type: 'number',
    placeholder: '0',
    min: 0,
  },
};

export const DateInput: Story = {
  args: {
    label: 'Select Date',
    type: 'date',
  },
};

export const TimeInput: Story = {
  args: {
    label: 'Select Time',
    type: 'time',
  },
};

// All sizes showcase
export const AllSizes: Story = {
  render: () => (
    <div className="space-y-4">
      <Input inputSize="sm" placeholder="Small input" />
      <Input inputSize="md" placeholder="Medium input" />
      <Input inputSize="lg" placeholder="Large input" />
    </div>
  ),
};

// Form example
export const FormExample: Story = {
  render: () => (
    <div className="space-y-4">
      <Input
        label="Business Name"
        placeholder="Enter business name"
      />
      <Input
        label="Email"
        type="email"
        placeholder="contact@business.com"
        leftIcon={<Mail className="w-4 h-4" />}
      />
      <Input
        label="Phone"
        type="tel"
        placeholder="+237 6XX XXX XXX"
        leftIcon={<Phone className="w-4 h-4" />}
      />
      <Input
        label="Password"
        type="password"
        placeholder="Enter password"
        hint="Must be at least 8 characters"
        leftIcon={<Lock className="w-4 h-4" />}
      />
    </div>
  ),
};
