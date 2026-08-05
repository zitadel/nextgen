import { useRouter } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { ApiError } from "@zitadel/api/runtime/fetch";
import { Alert, Icon } from "@zitadel/ui-react";
import { useEffect, useState } from "react";

import { fetchSession, invalidateSessionCache } from "../auth/session";

const STATE_ROW = "flex items-center gap-2 text-muted-foreground";

/** Shared pending boundary (Console ADR 0001). */
export function PendingState() {
  return (
    <div className={STATE_ROW} role="status" aria-live="polite">
      <Icon name="spinner" spin label="Loading" />
      <span>Loading…</span>
    </div>
  );
}

/**
 * Shared error boundary. Reads `ApiError.status` so HTTP failures get
 * status-specific copy while other throws fall back to a generic message.
 *
 * A data-load 401 has two distinct causes (Console ADR 0003), told apart by
 * re-probing the session:
 *
 * - **Session gone** — the cookie expired or was revoked mid-use: drop the
 *   cached session and redirect to the login screen with the current path in
 *   `?next=`, instead of rendering copy the user cannot act on.
 * - **Session alive** — the user is signed in but the console's operator-plane
 *   credential is missing or invalid (in dev: the proxy's
 *   `CONSOLE_PROJECT_SECRET`). Redirecting would bounce straight back and
 *   loop, so this renders an honest error state instead.
 *
 * 403 stays a rendered state — signed in, but no access.
 */
export function ErrorState({ error }: ErrorComponentProps) {
  const router = useRouter();
  const unauthenticated = error instanceof ApiError && error.status === 401;
  // null = probing, true = signed in (render copy), false = redirecting.
  const [sessionAlive, setSessionAlive] = useState<boolean | null>(null);

  useEffect(() => {
    if (!unauthenticated) return;
    let cancelled = false;
    invalidateSessionCache();
    void fetchSession().then((session) => {
      if (cancelled) return;
      if (session) {
        setSessionAlive(true);
        return;
      }
      setSessionAlive(false);
      const { pathname, searchStr } = router.state.location;
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const href = `${pathname}${searchStr}`;
      const next = base && href.startsWith(base) ? href.slice(base.length) : href;
      void router.navigate({
        to: "/login",
        search: { next: next === "/" ? undefined : next },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [unauthenticated, router]);

  if (unauthenticated) {
    if (sessionAlive) {
      return (
        <div className={STATE_ROW}>
          <Alert severity="error" heading="Console API not authorized">
            You are signed in, but the console&apos;s API requests are not authorized. In
            development, check that the dev proxy&apos;s <code>CONSOLE_PROJECT_SECRET</code> is set
            and belongs to the current project (ADR 0003 §4).
          </Alert>
        </div>
      );
    }
    return (
      <div className={STATE_ROW} role="status" aria-live="polite">
        <Icon name="spinner" spin label="Checking session" />
        <span>Checking your session…</span>
      </div>
    );
  }

  const { heading, message } = describeError(error);
  return (
    <div className={STATE_ROW}>
      <Alert severity="error" heading={heading}>
        {message}
      </Alert>
    </div>
  );
}

/** Shared not-found boundary. */
export function NotFoundState() {
  return (
    <div className={STATE_ROW}>
      <Alert severity="warning" heading="Not found">
        The page or resource you were looking for does not exist.
      </Alert>
    </div>
  );
}

function describeError(error: unknown): { heading: string; message: string } {
  if (error instanceof ApiError) {
    if (error.status === 403) {
      return {
        heading: "Not authorized",
        message: "You are signed in, but this account does not have access to this resource.",
      };
    }
    return {
      heading: `Request failed (${error.status})`,
      message: error.message,
    };
  }
  return {
    heading: "Something went wrong",
    message: error instanceof Error ? error.message : "An unexpected error occurred.",
  };
}
