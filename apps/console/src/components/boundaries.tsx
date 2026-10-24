import { Link, useRouter } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { ApiError, apiErrorCode } from "@zitadel/api/runtime/fetch";
import { Loader2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

import { fetchSession, invalidateSessionCache } from "@/auth/session";
import { describeError } from "@/lib/api-error";
import { routerRelativeHref } from "@/lib/base-path";

import { EYEBROW } from "./typography";

const STATE_ROW = "flex items-center justify-center gap-2 text-muted-foreground";

/**
 * Boundary states replace a whole routed screen, so they get the content area to
 * themselves and sit centred in it rather than wedged into its top left corner.
 * `flex-1` claims the height left by the context bar inside the shell; the
 * `min-h` covers the shell-less root boundaries, where there is no flex parent
 * to grow into.
 */
function StatePage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[60vh] flex-1 items-center justify-center px-6 py-8">
      <div className="w-full max-w-xl">{children}</div>
    </div>
  );
}

/**
 * The anatomy every error page shares (ADR 076): the status, a title, one
 * sentence, a way on and, for a refused request, the references to quote:
 * the error code, and the request ID that finds the request in the server's
 * logs. The docs and the server's own page show the same parts in their own
 * chrome.
 */
function ErrorPage({
  status,
  title,
  children,
  action,
  code,
  requestId,
}: {
  status?: number;
  title: string;
  children: ReactNode;
  action?: ReactNode;
  code?: string;
  requestId?: string;
}) {
  return (
    <StatePage>
      <div role="alert" className="flex flex-col items-center gap-3 text-center">
        {status !== undefined && <p className={EYEBROW}>Error {status}</p>}
        <h1 className="text-foreground font-serif text-2xl leading-8 tracking-tight text-balance">
          {title}
        </h1>
        <p className="text-muted-foreground max-w-md text-sm leading-6 text-pretty">{children}</p>
        {action && <div className="mt-3">{action}</div>}
        {(code || requestId) && (
          <p className="text-muted-foreground mt-3 flex flex-wrap justify-center gap-x-3 text-xs">
            {code && (
              <span>
                Code <code className="font-mono">{code}</code>
              </span>
            )}
            {requestId && (
              <span>
                Request ID <code className="font-mono">{requestId}</code>
              </span>
            )}
          </p>
        )}
      </div>
    </StatePage>
  );
}

/**
 * The way on from an error page: Projects, without the selected project. Not
 * the start page, which lands on Users while a project is selected, and not
 * with the project, which every link keeps (`retainSearchParams` in
 * `routes/_authed.tsx`): either would lead back to the screen that failed,
 * as it does for a `?project=` the server refuses. An explicit `undefined`
 * is what tells the middleware to drop it.
 */
function ProjectsLink() {
  return (
    <Button asChild variant="secondary">
      <Link to="/projects" search={{ project: undefined }}>
        Go to Projects
      </Link>
    </Button>
  );
}

/** Shared pending boundary (Console ADR 0001). */
export function PendingState() {
  return (
    <StatePage>
      <div className={STATE_ROW} role="status" aria-live="polite">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        <span>Loading…</span>
      </div>
    </StatePage>
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
 * - **Session alive** — `GET /sessions/me` still answers, but the server
 *   refused this request's session (an operation that does not accept the
 *   Console session, for instance). Redirecting would bounce straight back and
 *   loop, so this renders an honest error state instead.
 *
 * A `403 sess.project_mismatch` is probed the same way: the cookie now holds a
 * session of another project, such as an app's on the same host, so the
 * console's own session is gone. Any other 403 stays a rendered state —
 * signed in, but no access.
 */
export function ErrorState({ error }: ErrorComponentProps) {
  const router = useRouter();
  const unauthenticated =
    error instanceof ApiError &&
    (error.status === 401 || apiErrorCode(error) === "sess.project_mismatch");
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
      void router.navigate({
        to: "/login",
        search: { next: routerRelativeHref(`${pathname}${searchStr}`) },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [unauthenticated, router]);

  if (unauthenticated) {
    if (sessionAlive) {
      return (
        <ErrorPage
          status={error.status}
          title="Console API not authorized"
          code={apiErrorCode(error)}
          requestId={error.requestId}
          action={<ProjectsLink />}
        >
          You are signed in, but the server did not accept your session for this request. Signing
          out and in again may help; if it persists, this screen calls an operation the console
          session cannot use yet.
        </ErrorPage>
      );
    }
    return (
      <StatePage>
        <div className={STATE_ROW} role="status" aria-live="polite">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          <span>Checking your session…</span>
        </div>
      </StatePage>
    );
  }

  const { title, message, retry } = describeBoundaryError(error);
  return (
    <ErrorPage
      status={error instanceof ApiError ? error.status : undefined}
      title={title}
      code={apiErrorCode(error)}
      requestId={error instanceof ApiError ? error.requestId : undefined}
      action={
        retry ? (
          <Button variant="secondary" onClick={() => void router.invalidate()}>
            Try again
          </Button>
        ) : (
          <ProjectsLink />
        )
      }
    >
      {message}
    </ErrorPage>
  );
}

/** Shared not-found boundary: a path no route matches. */
export function NotFoundState() {
  return (
    <ErrorPage status={404} title="Page not found" action={<ProjectsLink />}>
      There is nothing at this address. The link may be broken, or the page may have moved.
    </ErrorPage>
  );
}

/**
 * The title and sentence for a failed load. The server owns the sentence
 * (`describeError`); the title says what kind of failure it is, in the words
 * every error page uses (ADR 076). A server fault or a request that got no
 * answer may pass on a second try; a refusal will not.
 */
function describeBoundaryError(error: unknown): { title: string; message: string; retry: boolean } {
  if (error instanceof ApiError) {
    if (error.status === 403) {
      return {
        title: "No access",
        message: describeError(error, "You are signed in, but this account cannot open this page."),
        retry: false,
      };
    }
    if (error.status === 404) {
      return {
        title: "Not found",
        message: describeError(error, "What this page shows does not exist, or no longer does."),
        retry: false,
      };
    }
    if (error.status >= 500) {
      return {
        title: "Something went wrong",
        message: describeError(
          error,
          "The server could not complete this request. Try again in a moment.",
        ),
        retry: true,
      };
    }
    return {
      title: "Request failed",
      message: describeError(error, "The server could not complete this request."),
      retry: false,
    };
  }
  return {
    title: "Something went wrong",
    message: describeError(error, "An unexpected error occurred."),
    retry: true,
  };
}
