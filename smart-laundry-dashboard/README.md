# Smart Laundry Management Dashboard

A unified management dashboard for Smart Laundry & Cafe Lounge - Douala. This frontend application provides real-time monitoring, financial reporting, and business intelligence for laundry operations.

## Features

- **Real-time Dashboard** - Live overview of revenue, machine status, and alerts
- **Machine Monitoring** - Track status of all 10 machines (6 washers + 4 dryers)
- **Transaction Management** - View, filter, and export payment transactions
- **Revenue Analytics** - Revenue tracking by provider, program, and time period
- **Maintenance Tracking** - Proactive maintenance alerts and history
- **Financial Reports** - Daily, monthly, and annual reports ready for accounting

## Tech Stack

- **Framework**: Next.js 14 (React)
- **Styling**: Tailwind CSS
- **Charts**: Recharts
- **Icons**: Lucide React
- **HTTP Client**: Axios
- **Real-time**: Socket.io Client

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Running backend API (SmartLaundromatControlSystem)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/YOUR_USERNAME/smart-laundry-dashboard.git
cd smart-laundry-dashboard
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
cp .env.example .env.local
```

Edit `.env.local` with your backend API URL:
```
NEXT_PUBLIC_API_URL=http://your-backend-url/api
NEXT_PUBLIC_WS_URL=ws://your-backend-url
```

4. Start the development server:
```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
smart-laundry-dashboard/
├── src/
│   ├── app/                    # Next.js App Router pages
│   │   ├── dashboard/          # Dashboard pages
│   │   │   ├── machines/       # Machine monitoring
│   │   │   ├── transactions/   # Transaction list
│   │   │   ├── revenue/        # Revenue analytics
│   │   │   ├── maintenance/    # Maintenance tracking
│   │   │   ├── reports/        # Financial reports
│   │   │   └── settings/       # Settings
│   │   ├── layout.tsx          # Root layout
│   │   └── page.tsx            # Home redirect
│   ├── components/
│   │   ├── ui/                 # Reusable UI components
│   │   ├── dashboard/          # Dashboard-specific components
│   │   ├── machines/           # Machine components
│   │   ├── transactions/       # Transaction components
│   │   ├── reports/            # Report components
│   │   └── maintenance/        # Maintenance components
│   ├── hooks/                  # Custom React hooks
│   ├── lib/                    # Utility functions
│   ├── services/               # API services
│   └── types/                  # TypeScript type definitions
├── public/                     # Static assets
├── docs/                       # Documentation
└── package.json
```

## API Integration

This dashboard connects to the SmartLaundromatControlSystem backend. The API service (`src/services/api.ts`) provides methods for:

- Dashboard summary and statistics
- Machine status and history
- Transaction listing and export
- Revenue analytics
- Maintenance alerts and logging
- Financial report generation

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint

## Payment Providers

The dashboard supports transactions from:
- CamPay
- MTN Mobile Money
- Orange Money
- Wave
- Nkwa

## User Roles

| Role | Access |
|------|--------|
| Owner | Full access to all features |
| Manager | Operations + Reports (no settings) |
| Staff | Machine monitoring only |
| Accountant | Reports only (read-only) |

## License

MIT

## Author

Smart Laundry & Cafe Lounge - Douala
