import { renderHook, act } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { describe, it, expect } from "vitest";

import type { AuthResult, ClientAuthResult, ZitadelAuthSession } from "../types";

// useAuth/AuthContextProvider come through the public client entry — the same
// path consumers use. ZitadelProvider is server-only (it accepts the
// token-bearing auth() result), so its public homes are /server and the root;
// tests import the defining module directly (the vitest alias stubs the
// server-only guard).
import { ZitadelProvider } from "../provider";
import { AuthContextProvider, useAuth } from "../react";

function wrapper(initialSession: AuthResult) {
  let setSessionRef: ((s: AuthResult) => void) | null = null;

  // biome-ignore lint/correctness/noComponentHookFactories: a fixture each test builds once, so the component keeps one identity across its renders.
  function Wrapper({ children }: { children: ReactNode }) {
    const [session, setSession] = useState<AuthResult>(initialSession);
    setSessionRef = setSession;
    return <ZitadelProvider session={session}>{children}</ZitadelProvider>;
  }

  return { Wrapper, getSetSession: () => setSessionRef };
}

describe("useAuth()", () => {
  it("returns signed-out state when provider has unauthenticated session", () => {
    const session: AuthResult = { isAuthenticated: false, session: null };
    const { Wrapper } = wrapper(session);
    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper });
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.session).toBeNull();
  });

  it("returns signed-in state when provider has authenticated session", () => {
    const session: AuthResult = {
      isAuthenticated: true,
      session: {
        userId: "user-1",
        identifier: "bob@example.com",
        identifierProperty: "email",
        display: "Bob",
        token: "tok",
      },
    };
    const { Wrapper } = wrapper(session);
    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper });
    expect(result.current.isAuthenticated).toBe(true);
    if (result.current.isAuthenticated) {
      expect(result.current.session.userId).toBe("user-1");
      expect(result.current.session.identifier).toBe("bob@example.com");
    }
  });

  it("strips the raw token before the session reaches client state", () => {
    const session: AuthResult = {
      isAuthenticated: true,
      session: {
        userId: "user-1",
        identifier: "bob@example.com",
        identifierProperty: "email",
        display: "Bob",
        token: "raw-session-token-must-not-leak",
      },
    };
    const { Wrapper } = wrapper(session);
    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper });

    expect(result.current.isAuthenticated).toBe(true);
    if (result.current.isAuthenticated) {
      // The context value is the client-safe shape: exactly identity fields,
      // no token property at all (not even undefined).
      expect(result.current.session).toEqual({
        userId: "user-1",
        identifier: "bob@example.com",
        identifierProperty: "email",
        display: "Bob",
      });
      expect("token" in result.current.session).toBe(false);
    }
  });

  it("hook updates when session changes via re-render", () => {
    const signedOut: AuthResult = { isAuthenticated: false, session: null };
    const signedIn: AuthResult = {
      isAuthenticated: true,
      session: {
        userId: "u2",
        identifier: "c@c.com",
        identifierProperty: "email",
        display: "C",
        token: "t2",
      },
    };

    const { Wrapper, getSetSession } = wrapper(signedOut);
    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper });
    expect(result.current.isAuthenticated).toBe(false);

    act(() => {
      const setSession = getSetSession();
      if (setSession) {
        setSession(signedIn);
      }
    });

    expect(result.current.isAuthenticated).toBe(true);
  });
});

describe("ZitadelProvider input shapes", () => {
  function renderWith(session: Parameters<typeof ZitadelProvider>[0]["session"]) {
    return renderHook(() => useAuth(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <ZitadelProvider session={session}>{children}</ZitadelProvider>
      ),
    });
  }

  it("treats null as signed out", () => {
    const { result } = renderWith(null);
    expect(result.current).toEqual({ isAuthenticated: false, session: null });
  });

  it("passes an already client-safe result through unchanged", () => {
    const clientResult: ClientAuthResult = {
      isAuthenticated: true,
      session: { userId: "u3", identifier: null, identifierProperty: null, display: null },
    };
    const { result } = renderWith(clientResult);
    expect(result.current).toEqual(clientResult);
  });

  it("wraps and strips a bare session object", () => {
    const bare: ZitadelAuthSession = {
      userId: "u4",
      identifier: "d@d.com",
      identifierProperty: "email",
      display: "D",
      token: "server-token",
    };
    const { result } = renderWith(bare);
    expect(result.current).toEqual({
      isAuthenticated: true,
      session: { userId: "u4", identifier: "d@d.com", identifierProperty: "email", display: "D" },
    });
  });
});

describe("AuthContextProvider (client-side seeding)", () => {
  it("feeds a client-safe value straight to useAuth()", () => {
    const seeded: ClientAuthResult = {
      isAuthenticated: true,
      session: { userId: "u5", identifier: "e@e.com", identifierProperty: "email", display: null },
    };
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <AuthContextProvider value={seeded}>{children}</AuthContextProvider>
      ),
    });
    expect(result.current).toEqual(seeded);
  });
});
