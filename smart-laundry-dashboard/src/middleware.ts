import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auth0 } from './lib/auth0';

const PUBLIC_PATHS = ['/login', '/forgot-password', '/reset-password'];
const PROTECTED_PREFIX = '/dashboard';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Let auth0 handle its own routes (/auth/*) and rolling session refresh
  const authResponse = await auth0.middleware(request);

  // After auth0 middleware runs, check route protection
  const isPublicPath = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  const isProtectedPath = pathname.startsWith(PROTECTED_PREFIX);
  const isRoot = pathname === '/';

  if (isRoot || isPublicPath || isProtectedPath) {
    const session = await auth0.getSession(request);
    const isAuthenticated = !!session;

    if (isRoot || isPublicPath) {
      // Authenticated users visiting root/login → dashboard
      if (isAuthenticated) {
        return NextResponse.redirect(new URL('/dashboard', request.url));
      }
      // Unauthenticated on login page → let them see it
      if (isPublicPath) return authResponse;
      // Unauthenticated on root → Auth0 login
      return NextResponse.redirect(new URL('/auth/login', request.url));
    }

    if (isProtectedPath && !isAuthenticated) {
      const returnTo = encodeURIComponent(pathname);
      return NextResponse.redirect(
        new URL(`/auth/login?returnTo=${returnTo}`, request.url),
      );
    }
  }

  return authResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
  ],
};
