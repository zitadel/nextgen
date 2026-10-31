"use client";
import { useOperation } from "fumadocs-openapi/operation";
import type { AuthProvider } from "fumadocs-openapi/playground";
import { ShieldCheck } from "lucide-react";
import { createContext, use, useEffect, useSyncExternalStore } from "react";

// The playground sends a read that accepts the session cookie with the
// reader's own session. On the cloud the docs, the Console and the API share
// one origin (vercel.json), the spec's server is that origin, and the
// playground's fetch keeps the browser's same-origin credentials, so the
// browser sends the Console's HttpOnly session cookie itself. Nothing
// reads or writes the cookie here, and nothing goes through a proxy: Fumadocs'
// proxy omits credentials.
//
// It sends no write with the session: there is no sandbox to send one to, so
// it would change the reader's real data from a page they came to read.

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

/** An operation as its playground knows it: `useOperation()`, `playground.render`. */
export interface PlaygroundOperation {
  method: string;
  path: string;
  operation: { security?: Record<string, string[]>[] };
}

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

/**
 * Whether a request only reads: a safe method, or `POST …/query`, which the
 * spec's sessionCookie scheme names the reads and the server asks no CSRF
 * token of (internal/api/csrf.go).
 */
function isRead({ method, path }: Pick<PlaygroundOperation, "method" | "path">): boolean {
  const verb = method.toUpperCase();
  return safeMethods.has(verb) || (verb === "POST" && path.endsWith("/query"));
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

// Why the playground does not send a write with the session, and what to do.
const readsOnly =
  "sends only reads with your session, and this request changes data. Send it from your own code instead, as its samples show.";

// On a read the note names the account and the API the request acts on; on a
// write it says why the playground sends none with the session.
function SessionNote() {
  const user = use(SessionUserContext);
  const reads = isRead(useOperation());

  return (
    <div className="flex gap-2 border-b px-4 py-2.5 text-xs text-fd-muted-foreground last:border-b-0">
      <ShieldCheck className="mt-px size-3.5 shrink-0" />
      <p className="min-w-0 flex-1 [&_a]:underline">
        {!reads && `The playground ${readsOnly}`}
        {reads && user === undefined && "Checking your session…"}
        {reads && user === null && (
          <>
            Sign in to the <a href="/console/">Console</a> and this request is sent with your
            session.
          </>
        )}
        {reads && user && (
          <>
            Sent with your session to the API at{" "}
            <span className="font-medium text-fd-foreground">{apiOrigin()}</span>, signed in as{" "}
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
// sees no URL; every one goes to the API, and its playground names the
// operation (components/api-page.tsx). One without a bearer token is the
// session cookie's: a write the session would authenticate is not sent, and a
// read leaves only as the account the page shows. When the cookie has changed
// hands, the request is not sent and the page shows whose it is now. The read
// of the cookie's account takes the request's signal, so its timeout ends it
// too.
export async function withReaderSession(
  init: RequestInit,
  sent: PlaygroundOperation,
): Promise<RequestInit> {
  if (new Headers(init.headers).has("Authorization")) return init;
  const session = sent.operation.security?.some((requirement) => sessionScheme in requirement);
  if (session && !isRead(sent)) throw new Error(`Not sent: the playground ${readsOnly}`);
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
  return init;
}

/** The API the playground's requests act on: the one at the page's origin. */
function apiOrigin(): string {
  return new URL(server, document.baseURI).origin;
}

function account(user: SessionUser | null): string {
  return user ? `signed in as ${user.display ?? user.identifier ?? user.user_id}` : "signed out";
}
