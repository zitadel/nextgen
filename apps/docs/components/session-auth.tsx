"use client";
import { CSRF_HEADER } from "@zitadel/api/runtime/fetch";
import type { AuthProvider } from "fumadocs-openapi/playground";
import { ShieldCheck } from "lucide-react";
import { createContext, use, useEffect, useState } from "react";

// The playground sends a request that accepts the session cookie with the
// reader's own session. On the cloud the docs, the Console and the API share
// one origin (vercel.json), the spec's server is that origin, and the
// playground's fetch keeps the browser's same-origin credentials, so the
// browser sends the Console's HttpOnly session cookie itself. Nothing
// reads or writes the cookie here, and nothing goes through a proxy: Fumadocs'
// proxy omits credentials.

/** The server the playground calls, the spec's: the page's own origin. */
const server = "/";

const sessionScheme = "sessionCookie";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export interface SessionUser {
  user_id: string;
  identifier?: string;
  display?: string;
}

/** The reader's signed-in user: undefined while it loads, null without one. */
export const SessionUserContext = createContext<SessionUser | null | undefined>(undefined);

/** Asks the server once per page who the session's user is. */
export function useSessionUser(): SessionUser | null | undefined {
  const [user, setUser] = useState<SessionUser | null>();

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${server}sessions/me`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const session = response.ok ? ((await response.json()) as { user?: SessionUser }) : {};
        setUser(session.user ?? null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setUser(null);
      });
    return () => controller.abort();
  }, []);

  return user;
}

// Fumadocs opens a playground on the operation's first security requirement,
// the project secret where an operation accepts both. For a signed-in reader
// the page's document lists the session's requirement first instead, so the
// playground opens on it; a reader who is not signed in keeps the spec's
// order. Path items are inline in the bundle (lib/source.ts).
export function sessionFirst<T extends { paths?: object }>(document: T): T {
  if (!document.paths) return document;
  const paths = Object.fromEntries(
    Object.entries(document.paths as Record<string, Record<string, unknown>>).map(
      ([path, item]) => [
        path,
        Object.fromEntries(
          Object.entries(item).map(([key, value]) => [key, withSessionFirst(value)]),
        ),
      ],
    ),
  );
  return { ...document, paths };
}

function withSessionFirst(operation: unknown): unknown {
  if (typeof operation !== "object" || operation === null || !("security" in operation)) {
    return operation;
  }
  const { security } = operation;
  if (!Array.isArray(security)) return operation;
  const session = security.filter((requirement) => sessionScheme in requirement);
  if (session.length === 0 || security[0] === session[0]) return operation;
  const others = security.filter((requirement) => !(sessionScheme in requirement));
  return { ...operation, security: [...session, ...others] };
}

// The cookie is the credential, so the scheme has no input to fill; Fumadocs'
// own would write a pasted value with `document.cookie`. The request data
// gets no cookie, and neither do the code samples (lib/sdk-sample.ts).
export const sessionAuthProvider: AuthProvider = {
  on: sessionScheme,
  render: SessionNote,
  onRequest() {},
};

function SessionNote() {
  const user = use(SessionUserContext);

  return (
    <div className="flex gap-2 border-b px-4 py-2.5 text-xs text-fd-muted-foreground last:border-b-0">
      <ShieldCheck className="mt-px size-3.5 shrink-0" />
      <p className="min-w-0 flex-1 [&_a]:underline">
        {user === undefined && "Checking your session…"}
        {user === null && (
          <>
            Sign in to the <a href="/console/">Console</a> and this request is sent with your
            session.
          </>
        )}
        {user && (
          <>
            Sent with your session, signed in as{" "}
            <span className="font-medium text-fd-foreground">
              {user.display ?? user.identifier ?? user.user_id}
            </span>
            .
          </>
        )}
      </p>
    </div>
  );
}

// A write the session cookie authenticates needs the session's CSRF token
// (the `sessionCookie` scheme). The playground's requests leave through
// `fetchOptions.onRequestInit`, which sees no URL, so every write gets the
// token unless a bearer authenticates it. The token is fetched per write: the
// reader may sign in or out in another tab, and a write here is rare.
export async function withCsrfToken(init: RequestInit): Promise<RequestInit> {
  if (safeMethods.has(init.method?.toUpperCase() ?? "GET")) return init;
  const headers = new Headers(init.headers);
  if (headers.has("Authorization")) return init;
  const token = await csrfToken();
  if (token) headers.set(CSRF_HEADER, token);
  return { ...init, headers };
}

async function csrfToken(): Promise<string | undefined> {
  try {
    const response = await fetch(`${server}sessions/me/csrf`, { cache: "no-store" });
    if (!response.ok) return undefined;
    const { csrf_token } = (await response.json()) as { csrf_token?: string };
    return csrf_token;
  } catch {
    return undefined;
  }
}
