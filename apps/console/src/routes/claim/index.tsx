import { createFileRoute } from "@tanstack/react-router";
import { fetchSession } from "@/auth/session";
import { STANDALONE_BODY, StandaloneMessage } from "@/components/standalone-screen";
import { fetchClaimWindow } from "@/features/claim/api";
import { stringParam } from "@/lib/search-params";
import { ClaimLogin, ClaimShell, CompleteClaim } from "@/features/claim/components/claim-screens";

/**
 * The claim page (#615, Claim H1) — the browser leg of a project claim.
 *
 * `claim/init` hands the CLI a URL of the form
 * `<console>/claim?challenge_id=…&project_id=…`. The developer lands here,
 * signs in or registers against the **platform project** — the console's own
 * identity project (ADR 0004), not the project being claimed — and the page
 * spends the challenge via `claim/complete`, authenticated by the
 * session cookie. The CLI meanwhile polls `claim/status`, so
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
