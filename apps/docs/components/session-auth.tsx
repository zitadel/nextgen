"use client";
import { CSRF_HEADER } from "@zitadel/api/runtime/fetch";
import type { AuthProvider } from "fumadocs-openapi/playground";
import { ShieldCheck } from "lucide-react";
import { createContext, use, useEffect, useSyncExternalStore } from "react";

// The playground sends a request that accepts the session cookie with the
// reader's own session. On the cloud the docs, the Console and the API share
// one origin (vercel.json), the spec's server is `/api/v1` on it (ADR 077),
// and the playground's fetch keeps the browser's same-origin credentials, so the
// browser sends the Console's HttpOnly session cookie itself. Nothing
// reads or writes the cookie here, and nothing goes through a proxy: Fumadocs'
// proxy omits credentials.

/** The server the playground calls, the spec's: `/api/v1` on the page's own origin. */
const server = "/api/v1/";

const sessionScheme = "sessionCookie";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export interface SessionUser {
  user_id: string;
  identifier?: string;
  display?: string;
}

/** The reader's signed-in user: undefined while it loads, null without one. */
export const SessionUserContext = createContext<SessionUser | null | undefined>(undefined);

// The account the page shows the reader. A request the session cookie
// authenticates leaves only while the cookie still belongs to it
// (`withReaderSession`): another tab may have signed out, or in as someone else.
let shown: SessionUser | null | undefined;
const watchers = new Set<() => void>();

function show(user: SessionUser | null) {
  shown = user;
  for (const notify of watchers) notify();
}

function watch(onChange: () => void) {
  watchers.add(onChange);
  return () => {
    watchers.delete(onChange);
  };
}

/** Asks the server once per page who the session's user is. */
export function useSessionUser(): SessionUser | null | undefined {
  const user = useSyncExternalStore(
    watch,
    () => shown,
    () => undefined,
  );

  useEffect(() => {
    const controller = new AbortController();
    readSessionUser(controller.signal).then(show, () => {
      if (!controller.signal.aborted) show(null);
    });
    return () => controller.abort();
  }, []);

  return user;
}

/** The session cookie's user now: null when nobody is signed in. */
async function readSessionUser(signal?: AbortSignal | null): Promise<SessionUser | null> {
  const response = await fetch(`${server}sessions/me`, { cache: "no-store", signal });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`GET /sessions/me answered ${response.status}`);
  const { user } = (await response.json()) as { user?: SessionUser };
  return user ?? null;
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

// The playground's requests leave through `fetchOptions.onRequestInit`, which
// sees no URL; every one goes to the API. One without a bearer token is the
// session cookie's, and it leaves only as the account the page shows: when the
// cookie has changed hands, the request is not sent and the page shows whose it
// is now. A write also carries the session's CSRF token (the `sessionCookie`
// scheme), read before the account: a switch after the check leaves the token
// the previous session's, which the server refuses. Both reads take the
// request's signal, so its timeout ends them too.
export async function withReaderSession(init: RequestInit): Promise<RequestInit> {
  const headers = new Headers(init.headers);
  if (headers.has("Authorization")) return init;
  const write = !safeMethods.has(init.method?.toUpperCase() ?? "GET");
  const token = write ? await csrfToken(init.signal) : undefined;
  const reader = await readSessionUser(init.signal);
  if (shown === undefined) {
    show(reader);
  } else if (reader?.user_id !== shown?.user_id) {
    const before = shown;
    show(reader);
    throw new Error(
      `Not sent: your session changed. This page showed you ${account(before)}; you are now ${account(reader)}.`,
    );
  }
  if (token) headers.set(CSRF_HEADER, token);
  return { ...init, headers };
}

function account(user: SessionUser | null): string {
  return user ? `signed in as ${user.display ?? user.identifier ?? user.user_id}` : "signed out";
}

async function csrfToken(signal?: AbortSignal | null): Promise<string | undefined> {
  const response = await fetch(`${server}sessions/me/csrf`, { cache: "no-store", signal });
  if (!response.ok) return undefined;
  const { csrf_token } = (await response.json()) as { csrf_token?: string };
  return csrf_token;
}
