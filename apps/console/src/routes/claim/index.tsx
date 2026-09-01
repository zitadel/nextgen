import { createFileRoute, Link } from "@tanstack/react-router";
import { ZitadelLogin, type ZitadelProject } from "@zitadel/sdk-react";
import { Loader2 } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import { apiBase } from "../../api/zitadel";
import { fetchSession } from "../../auth/session";
import { ZitadelMark } from "../../components/app-shell/icons";
import { type ClaimOutcome, completeProjectClaim } from "../../lib/claim";
import { getConsoleProjectId, getPublishableKey } from "../../runtime/runtime";
import { useTheme } from "../../theme";

/**
 * The claim page (#615, Claim H1) — the browser leg of a project claim.
 *
 * `claim/init` hands the CLI a URL of the form
 * `<console>/claim?challenge_id=…&project_id=…`. The developer lands here,
 * signs in or registers against the **platform project** — the console's own
 * identity project (ADR 0004), not the project being claimed — and the page
 * spends the challenge via `claim/complete`, authenticated by the
 * `__nextgen_session` cookie. The CLI meanwhile polls `claim/status`, so
 * success here is what unblocks the terminal.
 *
 * A top-level route outside `_authed` on purpose: an unauthenticated visitor
 * is the normal case, and bouncing them to `/login` would lose the claim
 * context. The sign-in widget renders inline instead (the same embedding as
 * `login.tsx`), with `postSignInUrl` pointing back at this URL — the widget's
 * terminal step is a full-document navigation, so the page reboots with the
 * cookie in place and completes the claim.
 *
 * Visual design for this page is still being refined; the layout mirrors the
 * login screen's centered column with token-correct styling until the frames
 * exist.
 */
export const Route = createFileRoute("/claim/")({
  validateSearch: (search: Record<string, unknown>): ClaimSearch => ({
    challenge_id: typeof search.challenge_id === "string" ? search.challenge_id : undefined,
    project_id: typeof search.project_id === "string" ? search.project_id : undefined,
  }),
  // A read, not the completion: the mutation lives in the component so loader
  // re-runs (preloads, invalidations) can never spend the single-use challenge.
  loader: async () => ({ session: await fetchSession() }),
  component: ClaimScreen,
});

export interface ClaimSearch {
  challenge_id?: string;
  project_id?: string;
}

const HEADING = "text-foreground font-serif text-xl";
const BODY_TEXT = "text-muted-foreground text-sm";

function ClaimScreen() {
  const { challenge_id, project_id } = Route.useSearch();
  const { session } = Route.useLoaderData();

  if (!challenge_id || !project_id) {
    return (
      <ClaimShell>
        <StateCard title="This claim link is not valid">
          <p className={BODY_TEXT}>
            The link is missing its claim parameters. Copy the URL from your terminal again, or
            re-run the claim to mint a fresh one.
          </p>
        </StateCard>
      </ClaimShell>
    );
  }

  if (!session) {
    return (
      <ClaimShell>
        <ClaimLogin challengeId={challenge_id} projectId={project_id} />
      </ClaimShell>
    );
  }

  return (
    <ClaimShell>
      {/*
        Keyed: CompleteClaim gates its single-use spend behind a ref, so a
        client-side navigation to a *different* claim URL would otherwise reuse
        the spent-once state and show the previous outcome. The key remounts it
        instead, which resets the gate without weakening it.
      */}
      <CompleteClaim
        key={`${project_id}:${challenge_id}`}
        projectId={project_id}
        challengeId={challenge_id}
      />
    </ClaimShell>
  );
}

/** The login screen's centered column (`login.tsx`), reused for every state. */
function ClaimShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-8 bg-background px-4 py-10">
      <ZitadelMark size={40} className="text-foreground" aria-hidden />
      <h1 className="sr-only">Claim your project</h1>
      {children}
    </main>
  );
}

function StateCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex max-w-md flex-col gap-3 text-center">
      <h2 className={HEADING}>{title}</h2>
      {children}
    </div>
  );
}

/**
 * The sign-in/registration leg: the embedded widget against the platform
 * project, exactly as `login.tsx` builds it (per-element project handle —
 * see that file for why attributes would lose to the app-wide
 * `configureZitadel()`). `purpose="login"` runs the project's default login
 * flow, whose definition owns the registration affordance; a claim-specific
 * flow would attach here via the widget's flow key once one exists.
 */
function ClaimLogin({ challengeId, projectId }: { challengeId: string; projectId: string }) {
  const { resolved: theme } = useTheme();
  const consoleProjectId = getConsoleProjectId();
  const publishableKey = getPublishableKey();

  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const params = new URLSearchParams({ challenge_id: challengeId, project_id: projectId });
  const postSignInUrl = `${base}/claim?${params.toString()}`;

  const project = useMemo<ZitadelProject | undefined>(
    () =>
      consoleProjectId
        ? Object.freeze({ projectId: consoleProjectId, proxyPath: apiBase, publishableKey })
        : undefined,
    [consoleProjectId, publishableKey],
  );

  if (!project) {
    return (
      <StateCard title="No project yet">
        <p className={BODY_TEXT}>
          This deployment has nothing to sign in to yet, so the claim cannot start. Finish the setup
          in your terminal, then reopen the claim link.
        </p>
      </StateCard>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <p className={BODY_TEXT}>Sign in or create an account to claim your project.</p>
      <ZitadelLogin project={project} purpose="login" theme={theme} postSignInUrl={postSignInUrl} />
    </div>
  );
}

/**
 * The completion leg. The challenge is single-use and first-claim-wins, so
 * one visit must spend it exactly once: the ref gates the effect against
 * re-renders and double-mounts, and only the explicit `Try again` button can
 * start another attempt.
 */
function CompleteClaim({ projectId, challengeId }: { projectId: string; challengeId: string }) {
  const [outcome, setOutcome] = useState<ClaimOutcome | null>(null);
  const startedRef = useRef(false);

  const run = useCallback(() => {
    setOutcome(null);
    void completeProjectClaim(projectId, challengeId).then(setOutcome);
  }, [projectId, challengeId]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    run();
  }, [run]);

  if (!outcome) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-sm" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Claiming your project…
      </div>
    );
  }

  switch (outcome.kind) {
    case "claimed":
      return (
        <StateCard title="Project claimed">
          <p className={BODY_TEXT}>
            The project now belongs to your personal team. You can return to your terminal — the CLI
            picks the claim up on its own.
          </p>
          <Button asChild className="mx-auto w-fit">
            <Link to="/">Open the console</Link>
          </Button>
        </StateCard>
      );
    case "already_claimed": {
      const dashboardUrl = safeHttpUrl(outcome.dashboardUrl);
      return (
        <StateCard title="Already claimed">
          <p className={BODY_TEXT}>{outcome.message}</p>
          {dashboardUrl && (
            <Button asChild variant="outline" className="mx-auto w-fit">
              <a href={dashboardUrl}>Open the owning team&rsquo;s dashboard</a>
            </Button>
          )}
        </StateCard>
      );
    }
    case "expired":
      return (
        <StateCard title="Claim link expired">
          <p className={BODY_TEXT}>{outcome.message}</p>
          <p className={BODY_TEXT}>
            Run the claim again from your terminal to mint a fresh link — this one is done.
          </p>
        </StateCard>
      );
    case "no_personal_team":
      // The contract states this code clears itself: the next sign-in
      // provisions the team. A retry is therefore honest here — unlike the
      // not-active case below, where retrying can only fail again.
      return (
        <StateCard title="Your account has no team yet">
          <p className={BODY_TEXT}>{outcome.message}</p>
          <p className={BODY_TEXT}>
            Signing in again normally provisions one. Retry, or reopen the link from your terminal.
          </p>
          <Button onClick={run} variant="outline" className="mx-auto w-fit">
            Try again
          </Button>
        </StateCard>
      );
    case "personal_team_not_active":
      // Deliberately no retry: the membership exists and is not active, and
      // the contract says provisioning will not change that. Only a person can.
      return (
        <StateCard title="This account cannot claim projects">
          <p className={BODY_TEXT}>{outcome.message}</p>
          <p className={BODY_TEXT}>{membershipRemedy(outcome.membershipStatus)}</p>
        </StateCard>
      );
    case "invalid_challenge":
      return (
        <StateCard title="This claim link is not valid">
          <p className={BODY_TEXT}>{outcome.message}</p>
        </StateCard>
      );
    case "unauthenticated":
      // NOT the sign-in widget again. The loader confirmed an active session
      // moments ago, so this 401 is almost never a lost cookie — it is the
      // server's deliberately opaque verdict for a session that cannot claim
      // (most often: it does not belong to the platform project, e.g. a
      // deployment running without `platform.bootstrap_project`, which is how
      // the local testkit boots today). Re-running sign-in mints the same
      // session and loops forever; an honest dead-end beats a treadmill.
      return (
        <StateCard title="Your session can't complete this claim">
          <p className={BODY_TEXT}>
            The server did not accept the signed-in session for this claim. On a deployment without
            a platform project, claims cannot complete; otherwise your session may have expired
            mid-claim — reopen the link from your terminal and sign in again.
          </p>
          <Button onClick={run} variant="outline" className="mx-auto w-fit">
            Try again
          </Button>
        </StateCard>
      );
    case "error":
      return (
        <StateCard title="The claim did not complete">
          <p className={BODY_TEXT}>{outcome.message}</p>
          <Button onClick={run} variant="outline" className="mx-auto w-fit">
            Try again
          </Button>
        </StateCard>
      );
  }
}

/**
 * Renders only http(s). The value comes from an error body — our own API,
 * declared `format: uri` — so this is defence in depth, but React will happily
 * render a `javascript:` href, and the sibling field is already read
 * defensively. A rejected URL costs the button, not the screen.
 */
function safeHttpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, window.location.origin);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * What actually unblocks each membership state, from the 403's contract text.
 * `removed` is the counter-intuitive one: deactivating a *user* cascades to
 * their memberships without touching the team, so the fix is the account's
 * access rather than the team's.
 */
function membershipRemedy(status: string | undefined): string {
  switch (status) {
    case "removed":
      return "The membership was withdrawn. Restoring this account's access is what unblocks the claim — the team itself may well still be active.";
    case "inactive":
      return "The membership is suspended. An administrator has to reactivate it before this account can claim a project.";
    case "pending":
      return "There is an invitation waiting to be accepted. Accept it, then reopen the claim link.";
    default:
      return "Ask an administrator to restore this account's team membership, then reopen the claim link.";
  }
}
