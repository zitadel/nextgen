import { describe, it, expect, vi, beforeEach } from 'vitest';

function base64url(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function makeFakeJwt(payload: Record<string, unknown>): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  return `${header}.${body}.fakesig`;
}

const mockHeadersMap = new Map<string, string>();

vi.mock('next/headers', () => ({
  headers: vi.fn(() =>
    Promise.resolve({
      get: (name: string) => mockHeadersMap.get(name) ?? null,
    }),
  ),
}));

describe('auth()', () => {
  beforeEach(() => {
    mockHeadersMap.clear();
    vi.resetModules();
  });

  it('returns unauthenticated when x-nextgen-auth-token header is absent', async () => {
    const { auth } = await import('../auth.js');
    const result = await auth();
    expect(result).toEqual({ isAuthenticated: false, session: null });
  });

  it('returns unauthenticated when x-nextgen-auth-token is an empty string', async () => {
    mockHeadersMap.set('x-nextgen-auth-token', '');
    const { auth } = await import('../auth.js');
    const result = await auth();
    expect(result).toEqual({ isAuthenticated: false, session: null });
  });

  it('returns authenticated session when a valid token is present', async () => {
    const token = makeFakeJwt({
      sub: 'user-abc',
      email: 'alice@example.com',
      name: 'Alice',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    mockHeadersMap.set('x-nextgen-auth-token', token);
    const { auth } = await import('../auth.js');
    const result = await auth();
    expect(result).toEqual({
      isAuthenticated: true,
      session: {
        userId: 'user-abc',
        email: 'alice@example.com',
        name: 'Alice',
        token,
      },
    });
  });

  it('returns authenticated session from opaque session headers', async () => {
    const token = 'opaque-session-token';
    mockHeadersMap.set('x-nextgen-auth-token', token);
    mockHeadersMap.set('x-nextgen-auth-user-id', 'user-opaque');

    const { auth } = await import('../auth.js');
    const result = await auth();

    expect(result).toEqual({
      isAuthenticated: true,
      session: {
        userId: 'user-opaque',
        email: null,
        name: null,
        token,
      },
    });
  });

  it('returns unauthenticated when token has no sub claim', async () => {
    const token = makeFakeJwt({
      email: 'alice@example.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    mockHeadersMap.set('x-nextgen-auth-token', token);
    const { auth } = await import('../auth.js');
    const result = await auth();
    expect(result).toEqual({ isAuthenticated: false, session: null });
  });

  it('returns unauthenticated when token is malformed', async () => {
    mockHeadersMap.set('x-nextgen-auth-token', 'not.a.valid.jwt.at.all.extra');
    const { auth } = await import('../auth.js');
    const result = await auth();
    expect(result).toEqual({ isAuthenticated: false, session: null });
  });

  it('returns null email and name when payload missing those fields', async () => {
    const token = makeFakeJwt({
      sub: 'user-xyz',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    mockHeadersMap.set('x-nextgen-auth-token', token);
    const { auth } = await import('../auth.js');
    const result = await auth();
    expect(result.isAuthenticated).toBe(true);
    if (result.isAuthenticated) {
      expect(result.session.email).toBeNull();
      expect(result.session.name).toBeNull();
    }
  });
});
