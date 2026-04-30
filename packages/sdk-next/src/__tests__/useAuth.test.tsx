import { renderHook, act } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { describe, it, expect } from 'vitest';

import type { AuthResult } from '../types';

import { NextgenProvider } from '../context';
import { useAuth } from '../useAuth';

function wrapper(initialSession: AuthResult) {
  let setSessionRef: ((s: AuthResult) => void) | null = null;

  function Wrapper({ children }: { children: ReactNode }) {
    const [session, setSession] = useState<AuthResult>(initialSession);
    setSessionRef = setSession;
    return <NextgenProvider session={session}>{children}</NextgenProvider>;
  }

  return { Wrapper, getSetSession: () => setSessionRef };
}

describe('useAuth()', () => {
  it('returns signed-out state when provider has unauthenticated session', () => {
    const session: AuthResult = { isAuthenticated: false, session: null };
    const { Wrapper } = wrapper(session);
    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper });
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.session).toBeNull();
  });

  it('returns signed-in state when provider has authenticated session', () => {
    const session: AuthResult = {
      isAuthenticated: true,
      session: {
        userId: 'user-1',
        email: 'bob@example.com',
        name: 'Bob',
        token: 'tok',
      },
    };
    const { Wrapper } = wrapper(session);
    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper });
    expect(result.current.isAuthenticated).toBe(true);
    if (result.current.isAuthenticated) {
      expect(result.current.session.userId).toBe('user-1');
      expect(result.current.session.email).toBe('bob@example.com');
    }
  });

  it('hook updates when session changes via re-render', () => {
    const signedOut: AuthResult = { isAuthenticated: false, session: null };
    const signedIn: AuthResult = {
      isAuthenticated: true,
      session: { userId: 'u2', email: 'c@c.com', name: 'C', token: 't2' },
    };

    const { Wrapper, getSetSession } = wrapper(signedOut);
    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper });
    expect(result.current.isAuthenticated).toBe(false);

    act(() => {
      const setSession = getSetSession();
      if (setSession) setSession(signedIn);
    });

    expect(result.current.isAuthenticated).toBe(true);
  });
});
