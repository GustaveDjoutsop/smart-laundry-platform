// Shared styles for Settings page components

export const styles = {
  // Layout
  container: 'flex flex-col lg:flex-row gap-6',
  sidebar: 'lg:w-64 flex-shrink-0',
  content: 'flex-1',

  // Card styles
  card: 'card',
  cardTitle: 'card-title mb-6',

  // Navigation
  nav: 'space-y-1',
  navButton: (isActive: boolean) =>
    `w-full flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
      isActive
        ? 'bg-primary-50 text-primary-700'
        : 'text-gray-600 hover:bg-gray-50'
    }`,
  navIcon: 'w-5 h-5 mr-3',

  // Form elements
  label: 'block text-sm font-medium text-gray-700 mb-1',
  input: 'input',
  inputReadOnly: 'input bg-gray-50 cursor-not-allowed',
  inputWrapper: 'relative',

  // Grid layouts
  gridCols2: 'grid grid-cols-2 gap-4',
  spaceY4: 'space-y-4',
  spaceY3: 'space-y-3',
  spaceY6: 'space-y-6',

  // Section titles
  sectionTitle: 'font-medium text-gray-900 mb-3',

  // Toggle switch
  toggle: {
    wrapper: 'relative inline-flex items-center cursor-pointer',
    input: 'sr-only peer',
    slider: 'w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[\'\'] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600',
    sliderDisabled: 'w-11 h-6 bg-gray-200 rounded-full after:content-[\'\'] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 cursor-not-allowed opacity-60',
  },

  // List items
  listItem: 'flex items-center justify-between p-4 bg-gray-50 rounded-lg',
  listItemActions: 'flex items-center space-x-3',

  // Buttons
  btnPrimary: 'btn btn-primary',
  btnSecondary: 'btn btn-secondary',
  btnLink: 'text-sm text-primary-600 hover:text-primary-700',

  // Badges
  badge: 'badge bg-primary-100 text-primary-700',

  // Avatar
  avatar: 'w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center mr-3',
  avatarText: 'text-primary-700 font-medium',

  // Alert/Message boxes
  alertError: 'mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm',
  alertSuccess: 'mb-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm',

  // Divider
  divider: 'pt-6 border-t',
} as const;

// Payment provider colors
export const providerColors: Record<string, string> = {
  'CamPay': 'bg-blue-100',
  'MTN MoMo': 'bg-yellow-100',
  'Orange Money': 'bg-orange-100',
  'Wave': 'bg-cyan-100',
  'Nkwa': 'bg-purple-100',
};
