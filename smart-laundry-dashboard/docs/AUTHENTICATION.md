# Authentication Strategy for Smart Laundry Dashboard

## Overview

This document describes the authentication and authorization strategy implemented in the Smart Laundry Dashboard frontend, designed to integrate with the SmartLaundromatControlSystem backend.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    laundry-dashboard (Frontend)                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────────┐      ┌─────────────────┐      ┌───────────┐  │
│   │  Login Page  │ ───► │   Auth Check    │ ───► │ Protected │  │
│   │   /login     │      │   Middleware    │      │ Dashboard │  │
│   └──────────────┘      └─────────────────┘      │ /dashboard│  │
│                                │                  └───────────┘  │
│                                │                                 │
│                                ▼                                 │
│                         ┌─────────────┐                          │
│                         │  JWT Token  │                          │
│                         └─────────────┘                          │
│                                │                                 │
└────────────────────────────────┼────────────────────────────────┘
                                 │
                                 │ Authorization: Bearer <token>
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    laundry-backend (Backend)                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────────┐      ┌─────────────────┐      ┌───────────┐  │
│   │  POST /auth  │      │   Verify JWT    │      │   Admin   │  │
│   │    /login    │      │   Middleware    │      │ Endpoints │  │
│   └──────────────┘      └─────────────────┘      │/api/admin │  │
│                                                   └───────────┘  │
│                                                                  │
│   + Role check: user.role === 'admin' | 'owner' | 'manager'     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Role-Based Access Control (RBAC)

### User Roles

```typescript
enum UserRole {
  OWNER = 'owner',           // Full access to everything
  MANAGER = 'manager',       // Operations + Reports
  STAFF = 'staff',           // Machine monitoring only
  ACCOUNTANT = 'accountant'  // Reports only
}
```

### Role Permissions Matrix

| Feature | OWNER | MANAGER | STAFF | ACCOUNTANT |
|---------|:-----:|:-------:|:-----:|:----------:|
| **Dashboard** |
| View Dashboard | ✅ | ✅ | ✅ | ✅ |
| **Machines** |
| View Machines | ✅ | ✅ | ✅ | ❌ |
| Control Machines | ✅ | ✅ | ✅ | ❌ |
| Schedule Maintenance | ✅ | ✅ | ❌ | ❌ |
| **Transactions** |
| View Transactions | ✅ | ✅ | ✅ | ✅ |
| Export Transactions | ✅ | ✅ | ❌ | ✅ |
| **Revenue & Reports** |
| View Revenue | ✅ | ✅ | ❌ | ✅ |
| View Reports | ✅ | ✅ | ❌ | ✅ |
| Export Reports | ✅ | ✅ | ❌ | ✅ |
| **Expenses** |
| View Expenses | ✅ | ✅ | ❌ | ✅ |
| Create Expenses | ✅ | ✅ | ❌ | ❌ |
| Edit Expenses | ✅ | ❌ | ❌ | ❌ |
| **Settings** |
| View Settings | ✅ | ❌ | ❌ | ❌ |
| Edit Settings | ✅ | ❌ | ❌ | ❌ |
| **User Management** |
| View Users | ✅ | ❌ | ❌ | ❌ |
| Create/Edit Users | ✅ | ❌ | ❌ | ❌ |
| Delete Users | ✅ | ❌ | ❌ | ❌ |
| **Café** |
| View Café | ✅ | ✅ | ❌ | ❌ |
| Manage Café | ✅ | ✅ | ❌ | ❌ |
| **Reconciliation** |
| Run Reconciliation | ✅ | ✅ | ❌ | ❌ |

### Protected Routes

| Route | Allowed Roles |
|-------|---------------|
| `/dashboard` | OWNER, MANAGER, STAFF, ACCOUNTANT |
| `/dashboard/machines` | OWNER, MANAGER, STAFF |
| `/dashboard/transactions` | OWNER, MANAGER, STAFF, ACCOUNTANT |
| `/dashboard/revenue` | OWNER, MANAGER, ACCOUNTANT |
| `/dashboard/maintenance` | OWNER, MANAGER |
| `/dashboard/reports` | OWNER, MANAGER, ACCOUNTANT |
| `/dashboard/settings` | OWNER |
| `/dashboard/cafe` | OWNER, MANAGER |

## Implementation

### File Structure

```
src/
├── lib/
│   └── auth/
│       ├── index.ts        # Main exports
│       ├── types.ts        # TypeScript types & role definitions
│       ├── utils.ts        # Utility functions (token, permissions)
│       ├── api.ts          # Auth API endpoints
│       └── context.tsx     # React context & AuthProvider
├── components/
│   └── auth/
│       ├── index.ts        # Component exports
│       ├── ProtectedRoute.tsx   # Route protection wrapper
│       ├── RoleGuard.tsx        # Role-based UI rendering
│       └── PermissionGuard.tsx  # Permission-based UI rendering
├── app/
│   ├── layout.tsx          # Root layout with AuthProvider
│   └── login/
│       └── page.tsx        # Login page
└── middleware.ts           # Next.js route middleware
```

### Core Components

#### 1. AuthProvider

Wraps the application and provides authentication state globally.

```tsx
// src/app/layout.tsx
import { AuthProvider } from '@/lib/auth';

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
```

#### 2. useAuth Hook

Access authentication state and methods anywhere in the app.

```tsx
import { useAuth } from '@/lib/auth';

function MyComponent() {
  const {
    user,              // Current user object
    isAuthenticated,   // Boolean auth status
    isLoading,         // Loading state
    login,             // Login function
    logout,            // Logout function
    checkPermission,   // Check specific permission
    checkRole,         // Check user roles
  } = useAuth();

  // Example usage
  if (checkPermission('expenses:create')) {
    return <CreateExpenseButton />;
  }
}
```

#### 3. ProtectedRoute Component

Wrap pages or sections that require authentication and/or specific roles.

```tsx
import { ProtectedRoute } from '@/components/auth';
import { UserRole } from '@/lib/auth';

function AdminPage() {
  return (
    <ProtectedRoute requiredRoles={[UserRole.OWNER, UserRole.MANAGER]}>
      <AdminPanel />
    </ProtectedRoute>
  );
}
```

#### 4. RoleGuard Component

Conditionally render UI elements based on user role.

```tsx
import { RoleGuard } from '@/components/auth';
import { UserRole } from '@/lib/auth';

function Navigation() {
  return (
    <nav>
      <Link href="/dashboard">Dashboard</Link>

      <RoleGuard allowedRoles={[UserRole.OWNER]}>
        <Link href="/dashboard/settings">Settings</Link>
      </RoleGuard>

      <RoleGuard allowedRoles={[UserRole.OWNER, UserRole.MANAGER, UserRole.ACCOUNTANT]}>
        <Link href="/dashboard/reports">Reports</Link>
      </RoleGuard>
    </nav>
  );
}
```

#### 5. PermissionGuard Component

Conditionally render UI elements based on specific permissions.

```tsx
import { PermissionGuard } from '@/components/auth';

function ExpensesPage() {
  return (
    <div>
      <h1>Expenses</h1>

      <PermissionGuard permission="expenses:create">
        <button>Add Expense</button>
      </PermissionGuard>

      <PermissionGuard permission="expenses:export">
        <button>Export CSV</button>
      </PermissionGuard>
    </div>
  );
}
```

### Middleware (SSR Route Protection)

The Next.js middleware handles server-side route protection.

```typescript
// src/middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const token = request.cookies.get('auth_token')?.value;
  const { pathname } = request.nextUrl;

  // Redirect unauthenticated users to login
  if (!token && pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Redirect authenticated users away from login
  if (token && pathname === '/login') {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}
```

## Authentication Flow

### Login Flow

```
1. User visits /login
2. User enters credentials (email, password)
3. Frontend sends POST /api/auth/login
4. Backend validates credentials
5. Backend returns JWT token + user object
6. Frontend stores token in localStorage
7. Frontend stores user in localStorage
8. Frontend redirects to /dashboard (or intended URL)
```

### Session Validation Flow

```
1. User visits protected route
2. Middleware checks for auth_token cookie
3. If no token → redirect to /login
4. AuthProvider initializes with stored token/user
5. AuthProvider checks token expiry
6. If expired → attempt refresh or logout
7. If valid → render protected content
```

### Logout Flow

```
1. User clicks "Sign Out"
2. Frontend calls POST /api/auth/logout
3. Frontend clears localStorage (token + user)
4. Frontend redirects to /login
```

## API Integration

### Required Backend Endpoints

The frontend expects these authentication endpoints:

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Authenticate and get JWT |
| POST | `/api/auth/logout` | Invalidate session |
| GET | `/api/auth/me` | Get current user profile |
| POST | `/api/auth/refresh` | Refresh JWT token |
| POST | `/api/auth/change-password` | Change password |
| POST | `/api/auth/forgot-password` | Request password reset |
| POST | `/api/auth/reset-password` | Reset password with token |

### Login Request/Response

**Request:**
```json
POST /api/auth/login
{
  "email": "admin@laundromat.com",
  "password": "securepassword"
}
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user_123",
    "email": "admin@laundromat.com",
    "name": "Admin User",
    "role": "owner",
    "createdAt": "2024-01-01T00:00:00Z",
    "lastLogin": "2024-12-19T10:30:00Z"
  }
}
```

### JWT Token Structure

```json
{
  "userId": "user_123",
  "email": "admin@laundromat.com",
  "role": "owner",
  "iat": 1703000000,
  "exp": 1703086400
}
```

## Security Considerations

### Token Storage
- JWT token stored in `localStorage` for persistence
- User data cached in `localStorage` for quick access
- Tokens cleared on logout or expiry

### Token Expiry
- Frontend checks token expiry before API calls
- Automatic refresh attempt when token expires
- Forced logout if refresh fails

### Route Protection
- Server-side: Next.js middleware blocks unauthorized access
- Client-side: AuthProvider redirects and shows loading states
- Component-level: Guards prevent unauthorized UI rendering

### Best Practices
1. Use HTTPS in production
2. Set secure, httpOnly cookies for tokens (recommended upgrade)
3. Implement token refresh rotation
4. Log authentication events for audit
5. Rate limit login attempts on backend

## Usage Examples

### Checking Permissions in Code

```typescript
import { useAuth } from '@/lib/auth';

function MyComponent() {
  const { checkPermission, checkRole } = useAuth();

  // Check single permission
  const canCreateExpense = checkPermission('expenses:create');

  // Check multiple roles
  const isManager = checkRole([UserRole.OWNER, UserRole.MANAGER]);

  return (
    <div>
      {canCreateExpense && <CreateButton />}
      {isManager && <ManagerTools />}
    </div>
  );
}
```

### Programmatic Role Checking

```typescript
import { hasPermission, hasAnyRole, isRoleAtLeast } from '@/lib/auth';

// Check if user has specific permission
const canEdit = hasPermission(user, 'settings:edit');

// Check if user has any of the roles
const canViewReports = hasAnyRole(user, [UserRole.OWNER, UserRole.ACCOUNTANT]);

// Check role hierarchy
const isAtLeastManager = isRoleAtLeast(user, UserRole.MANAGER);
```

### Getting Role Display Info

```typescript
import { getRoleDisplayName, getRoleBadgeColor } from '@/lib/auth';

function UserBadge({ role }) {
  return (
    <span className={getRoleBadgeColor(role)}>
      {getRoleDisplayName(role)}
    </span>
  );
}
// Output: <span class="bg-purple-100 text-purple-700">Owner</span>
```

## Environment Configuration

Add to `.env.local`:

```env
# Backend API URL
NEXT_PUBLIC_API_URL=http://localhost:3000/api
```

## Testing

### Test Users (Development)

| Email | Password | Role |
|-------|----------|------|
| owner@laundromat.com | owner123 | OWNER |
| manager@laundromat.com | manager123 | MANAGER |
| staff@laundromat.com | staff123 | STAFF |
| accountant@laundromat.com | accountant123 | ACCOUNTANT |

*Note: These test users need to be created in the backend database.*

---

## Related Files

- [src/lib/auth/types.ts](../src/lib/auth/types.ts) - Type definitions
- [src/lib/auth/utils.ts](../src/lib/auth/utils.ts) - Utility functions
- [src/lib/auth/context.tsx](../src/lib/auth/context.tsx) - Auth context
- [src/app/login/page.tsx](../src/app/login/page.tsx) - Login page
- [src/middleware.ts](../src/middleware.ts) - Route middleware
