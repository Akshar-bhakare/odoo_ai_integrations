'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { SessionActor, SessionResponse } from '@/lib/incentives/ui/types';

interface SessionContextValue {
  actor: SessionActor;
  request<T>(url: string, init?: RequestInit): Promise<T>;
  logout(): Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function IncentiveSessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    fetch('/api/auth/session', { cache: 'no-store' })
      .then(async (response) => {
        if (response.status === 401) {
          router.replace(`/login?next=${encodeURIComponent(pathname)}`);
          return null;
        }
        const data = await response.json() as SessionResponse & { error?: string };
        if (!response.ok) throw new Error(data.error ?? 'Could not load session');
        return data;
      })
      .then((data) => { if (active && data) setSession(data); })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not load session');
      });
    return () => { active = false; };
  }, [pathname, router]);

  const request = useCallback(async <T,>(url: string, init: RequestInit = {}): Promise<T> => {
    if (!session) throw new Error('Session is still loading');
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers);
    if (method !== 'GET' && method !== 'HEAD') headers.set('x-csrf-token', session.csrfToken);
    if (init.body && !headers.has('Content-Type') && !(init.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }
    const response = await fetch(url, { ...init, headers, cache: 'no-store' });
    const data = await response.json().catch(() => ({})) as T & { error?: string; message?: string };
    if (response.status === 401) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      throw new Error('Your session expired. Please sign in again.');
    }
    if (!response.ok) throw new Error(data.error ?? data.message ?? `Request failed (${response.status})`);
    return data;
  }, [pathname, router, session]);

  const logout = useCallback(async () => {
    if (!session) return;
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'x-csrf-token': session.csrfToken },
    });
    router.replace('/login');
    router.refresh();
  }, [router, session]);

  const value = useMemo(() => session ? { actor: session.actor, request, logout } : null, [logout, request, session]);

  if (error) {
    return <div className="m-auto max-w-lg rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">{error}</div>;
  }
  if (!value) {
    return <div className="m-auto flex items-center gap-3 text-sm text-muted-custom"><span className="h-4 w-4 animate-spin rounded-full border-2 border-border-custom border-t-accent-custom" />Verifying session…</div>;
  }
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useIncentiveSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useIncentiveSession must be used inside IncentiveSessionProvider');
  return value;
}
