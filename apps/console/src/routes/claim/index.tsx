import { createFileRoute } from "@tanstack/react-router";
import { ZitadelLogin } from "@zitadel/sdk-react";
import { Loader2 } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { fetchSession } from "@/auth/session";
import { ClaimOutcomeCard } from "@/components/claim/claim-outcome";
import {
  NoProjectYet,
  STANDALONE_BODY,
  StandaloneMessage,
  StandaloneScreen,
} from "@/components/standalone-screen";
import { Badge } from "@/components/ui/badge";
import { useConsoleProject } from "@/hooks/use-console-project";
import { withBasePath } from "@/lib/base-path";
import { type ClaimOutcome, type ClaimWindow, fetchClaimWindow, spendClaim } from "@/lib/claim";
import { stringParam } from "@/lib/search-params";
import { clearSessionCaches } from "@/lib/session-cache";
import { useTheme } from "@/theme";

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
 * login screen's centred column until a design exists.
 */
export const Route = createFileRoute("/claim/")({
  validateSearch: (search: Record<string, unknown>): ClaimSearch => ({
    challenge_id: stringParam(search.challenge_id),
    project_id: stringParam(search.project_id),
  }),
  // Reads, not the completion: the mutation lives in the component so loader
  // re-runs (preloads, invalidations) can never spend the single-use
  // challenge. `fetchClaimWindow` is idempotent and resolves to `undefined`
  // on any failure, so the two run together and neither can fail the route.
  loader: async ({ location }) => {
    const search = location.search as ClaimSearch;
    const [session, window] = await Promise.all([
      fetchSession(),
      search.challenge_id && search.project_id
        ? fetchClaimWindow(search.project_id, search.challenge_id)
        : undefined,
    ]);
    return { session, window };
  },
  // Loaded once per document, never on a navigation the router sees while the
  // page is up. The sign-in widget moves the history stack for its back
  // gesture (ADR 022), and each of those moves is a navigation to the router;
  // a loader that reloaded on them could read the session the widget's
  // handoff exchange had just created and hand the page to `CompleteClaim`
  // in a document the widget is already navigating away from — spending the
  // challenge here and again in the next document. The intended way back is
  // a full-document navigation, so the initial read is the only one that
  // matters.
  shouldReload: false,
  component: ClaimScreen,
});

export interface ClaimSearch {
  challenge_id?: string;
  project_id?: string;
}

function ClaimScreen() {
  const { challenge_id, project_id } = Route.useSearch();
  const { session, window } = Route.useLoaderData();

  if (!challenge_id || !project_id) {
    return (
      <ClaimShell>
        <StandaloneMessage title="This claim link is not valid">
          <p className={STANDALONE_BODY}>
            The link is missing its claim parameters. Copy the URL from your terminal again, or
            re-run the claim to mint a fresh one.
          </p>
        </StandaloneMessage>
      </ClaimShell>
    );
  }

  if (!session) {
    // The widget owns the trustmark row the badge belongs on, so the window
    // rides into it through the widget's `attribution-trailing` slot.
    return (
      <ClaimShell>
        <ClaimLogin challengeId={challenge_id} projectId={project_id} window={window} />
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
      {/*
        No widget on this leg, so no trustmark row to slot into — the badge
        stands under the outcome instead, which is why CompleteClaim renders
        it: only the outcome knows whether a countdown still means anything.
      */}
      <CompleteClaim
        key={`${project_id}:${challenge_id}`}
        projectId={project_id}
        challengeId={challenge_id}
        window={window}
      />
    </ClaimShell>
  );
}

/** The login screen's centred column, reused for every state. */
function ClaimShell({ children }: { children: ReactNode }) {
  return <StandaloneScreen heading="Claim your project">{children}</StandaloneScreen>;
}

/**
 * The claim window, as the badge the design draws beside the trustmark
 * ("Blocks / signup", `Badge` variant `secondary`).
 *
 * It is about the *project*, not the link in the address bar: an unclaimed
 * project can be claimed for 14 days after it is created (ADR 046), while the
 * link itself lapses in minutes. Both can therefore be true at once — an
 * expired link with eleven days still on the window — so it renders beside a
 * failed outcome rather than instead of one. A claimed project is the
 * exception: nothing is left to count down, and `CompleteClaim` drops it.
 *
 * Days, not a ticking clock: the window is two weeks long, so a
 * second-by-second timer would be motion that never tells the reader anything.
 * `expired` is the server's verdict; the day count is only ever derived for
 * display, and "today" is the skew case — a deadline already past that the
 * server still calls open.
 */
function ClaimWindowBadge({ window, slot }: { window: ClaimWindow; slot?: string }) {
  const days = daysUntil(window.expiresAt);
  return (
    <Badge variant="secondary" slot={slot}>
      {window.expired ? "Claim window expired" : days === 0 ? "Expires today" : `Expires in ${days} ${days === 1 ? "day" : "days"}`}
    </Badge>
  );
}

/**
 * Whole days from now until `at`, rounded up so a deadline later today reads
 * as a day left rather than as zero-and-expired, and floored at 0 — the server
 * owns the expired verdict, and a clock a few minutes fast must not produce a
 * negative count next to a window it still calls open.
 */
function daysUntil(at: Date): number {
  const ms = at.getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

/**
 * The sign-in/registration leg: the embedded widget against the platform
 * project, exactly as `login.tsx` builds it (per-element project handle —
 * see that file for why attributes would lose to the app-wide
 * `configureZitadel()`).
 *
 * `purpose="register"`, not `"login"`: a developer arriving from `zitadel
 * claim` in their terminal has, in the normal case, no account on this
 * deployment yet, so the sign-in step is a dead end they have to notice a
 * link to escape. The default flow's `register` purpose enters at the
 * `register` step (`packages/config/defaults/default-login.json`), whose
 * `sign_in` action navigates back to `identifier` for the returning
 * developer — so the rarer case costs one click and the common case costs
 * none. A claim-specific flow would attach here via the widget's flow key
 * once one exists.
 */
function ClaimLogin({
  challengeId,
  projectId,
  window,
}: {
  challengeId: string;
  projectId: string;
  window?: ClaimWindow;
}) {
  const { resolved: theme } = useTheme();
  const params = new URLSearchParams({ challenge_id: challengeId, project_id: projectId });
  const postSignInUrl = withBasePath(`/claim?${params.toString()}`);
  const project = useConsoleProject();

  if (!project) {
    return (
      <NoProjectYet>
        This deployment has nothing to sign in to yet, so the claim cannot start. Finish the setup
        in your terminal, then reopen the claim link.
      </NoProjectYet>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <p className={STANDALONE_BODY}>Create an account or sign in to claim your project.</p>
      <ZitadelLogin
        project={project}
        purpose="register"
        theme={theme}
        postSignInUrl={postSignInUrl}
      >
        {/*
          Light-DOM content projected into the widget's shadow trustmark row,
          which is what puts the badge on that row and keeps it styled by the
          console rather than by the widget. `slot` goes on the badge itself,
          not a wrapper: a wrapping span is blockified as a flex item and its
          line box makes the row 24px tall, which pushes the badge 1.5px off
          the mark's centre line. The badge is already `inline-flex` at the
          design's 20px, so it centres exactly.
        */}
        {window && <ClaimWindowBadge window={window} slot="attribution-trailing" />}
      </ZitadelLogin>
    </div>
  );
}

/**
 * The completion leg. The challenge is single-use and first-claim-wins, so
 * one visit must spend it exactly once: the ref gates the effect against
 * re-renders, `spendClaim` gates it across mounts, and only the explicit
 * `Try again` button can start another attempt.
 */
function CompleteClaim({
  projectId,
  challengeId,
  window,
}: {
  projectId: string;
  challengeId: string;
  window?: ClaimWindow;
}) {
  const [outcome, setOutcome] = useState<ClaimOutcome | null>(null);
  const startedRef = useRef(false);

  const run = useCallback(
    (retrying: boolean) => {
      setOutcome(null);
      void spendClaim(projectId, challengeId, retrying).then((result) => {
        // The claim just granted a project. A projects list read before it
        // (`lib/session-cache.ts`) would pick the default without it, so
        // "Open the console" asks again.
        if (result.kind === "claimed") clearSessionCaches();
        setOutcome(result);
      });
    },
    [projectId, challengeId],
  );

  const retry = useCallback(() => run(true), [run]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    run(false);
  }, [run]);

  if (!outcome) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-sm" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Claiming your project…
      </div>
    );
  }

  // The window says how long is left to claim. Once the project is claimed —
  // by this attempt or an earlier one — there is nothing left to count down,
  // so the badge goes rather than contradicting the outcome above it.
  const settled = outcome.kind === "claimed" || outcome.kind === "already_claimed";
  return (
    <>
      <ClaimOutcomeCard outcome={outcome} retry={retry} />
      {window && !settled && <ClaimWindowBadge window={window} />}
    </>
  );
}
