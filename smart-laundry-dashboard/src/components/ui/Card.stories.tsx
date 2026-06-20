import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './Card';
import { Button } from './Button';

const meta: Meta<typeof Card> = {
  title: 'UI/Card',
  component: Card,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'elevated', 'outline', 'ghost'],
    },
    padding: {
      control: 'select',
      options: ['none', 'sm', 'md', 'lg'],
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: (
      <>
        <CardHeader>
          <CardTitle>Card Title</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-600">
            This is the card content. You can put any content here.
          </p>
        </CardContent>
      </>
    ),
    className: 'w-[350px]',
  },
};

export const Elevated: Story = {
  args: {
    variant: 'elevated',
    children: (
      <>
        <CardHeader>
          <CardTitle>Elevated Card</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-600">
            This card has more shadow for emphasis.
          </p>
        </CardContent>
      </>
    ),
    className: 'w-[350px]',
  },
};

export const Outline: Story = {
  args: {
    variant: 'outline',
    children: (
      <>
        <CardHeader>
          <CardTitle>Outline Card</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-600">
            This card has no shadow, just a border.
          </p>
        </CardContent>
      </>
    ),
    className: 'w-[350px]',
  },
};

export const Ghost: Story = {
  args: {
    variant: 'ghost',
    children: (
      <>
        <CardHeader>
          <CardTitle>Ghost Card</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-600">
            This card has a subtle background.
          </p>
        </CardContent>
      </>
    ),
    className: 'w-[350px]',
  },
};

export const WithDescription: Story = {
  args: {
    children: (
      <>
        <CardHeader>
          <div>
            <CardTitle>Card with Description</CardTitle>
            <CardDescription>This is a helpful description</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-gray-600">
            Card content goes here.
          </p>
        </CardContent>
      </>
    ),
    className: 'w-[350px]',
  },
};

export const WithFooter: Story = {
  args: {
    children: (
      <>
        <CardHeader>
          <CardTitle>Card with Footer</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-600">
            This card has action buttons in the footer.
          </p>
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Button variant="secondary">Cancel</Button>
          <Button variant="primary">Save</Button>
        </CardFooter>
      </>
    ),
    className: 'w-[350px]',
  },
};

export const SmallPadding: Story = {
  args: {
    padding: 'sm',
    children: (
      <>
        <CardHeader>
          <CardTitle>Compact Card</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-600">Less padding for compact layouts.</p>
        </CardContent>
      </>
    ),
    className: 'w-[350px]',
  },
};

export const LargePadding: Story = {
  args: {
    padding: 'lg',
    children: (
      <>
        <CardHeader>
          <CardTitle>Spacious Card</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-600">More padding for emphasis.</p>
        </CardContent>
      </>
    ),
    className: 'w-[350px]',
  },
};

export const Interactive: Story = {
  args: {
    children: (
      <>
        <CardHeader>
          <CardTitle>Interactive Card</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-600">Hover to see the effect.</p>
        </CardContent>
      </>
    ),
    className: 'w-[350px] cursor-pointer hover:shadow-lg transition-shadow',
  },
};

export const AllVariants: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-4">
      <Card variant="default" className="w-[250px]">
        <CardHeader><CardTitle>Default</CardTitle></CardHeader>
        <CardContent><p className="text-gray-600">Default variant</p></CardContent>
      </Card>
      <Card variant="elevated" className="w-[250px]">
        <CardHeader><CardTitle>Elevated</CardTitle></CardHeader>
        <CardContent><p className="text-gray-600">Elevated variant</p></CardContent>
      </Card>
      <Card variant="outline" className="w-[250px]">
        <CardHeader><CardTitle>Outline</CardTitle></CardHeader>
        <CardContent><p className="text-gray-600">Outline variant</p></CardContent>
      </Card>
      <Card variant="ghost" className="w-[250px]">
        <CardHeader><CardTitle>Ghost</CardTitle></CardHeader>
        <CardContent><p className="text-gray-600">Ghost variant</p></CardContent>
      </Card>
    </div>
  ),
};
