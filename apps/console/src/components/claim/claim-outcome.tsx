import { Link } from "@tanstack/react-router";

import { STANDALONE_BODY, StandaloneMessage } from "@/components/standalone-screen";
import { Button } from "@/components/ui/button";
import type { ClaimOutcome } from "@/lib/claim";

/**
 * The screen for one completion outcome. Every branch is a state the contract
 * enumerates (`claim/complete` in the OpenAPI source), not an exception.
 */
export function ClaimOutcomeCard({ outcome, retry }: { outcome: ClaimOutcome; retry: () => void }) {
  switch (outcome.kind) {
    case "claimed":
      return (
        <StandaloneMessage title="Project claimed">
          <p className={STANDALONE_BODY}>
            Your project is now permanent. Open the console to manage it and start collaborating
            with your team.
          </p>
          <Button asChild className="mx-auto w-fit">
            <Link to="/">Open the console</Link>
          </Button>
        </StandaloneMessage>
      );
    case "already_claimed": {
      const dashboardUrl = safeHttpUrl(outcome.dashboardUrl);
      return (
        <StandaloneMessage title="Already claimed">
          <p className={STANDALONE_BODY}>{outcome.message}</p>
          {dashboardUrl && (
            <Button asChild variant="outline" className="mx-auto w-fit">
              <a href={dashboardUrl}>Open the owning team&rsquo;s dashboard</a>
            </Button>
          )}
        </StandaloneMessage>
      );
    }
    case "expired":
      return (
        <StandaloneMessage title="Claim link expired">
          <p className={STANDALONE_BODY}>{outcome.message}</p>
          <p className={STANDALONE_BODY}>
            Run the claim again from your terminal to mint a fresh link — this one is done.
          </p>
        </StandaloneMessage>
      );
    case "no_personal_team":
      // The contract states this code clears itself: the next sign-in
      // provisions the team. A retry is therefore honest here — unlike the
      // not-active case below, where retrying can only fail again.
      return (
        <StandaloneMessage title="Your account has no team yet">
          <p className={STANDALONE_BODY}>{outcome.message}</p>
          <p className={STANDALONE_BODY}>
            Signing in again normally provisions one. Retry, or reopen the link from your terminal.
          </p>
          <Button onClick={retry} variant="outline" className="mx-auto w-fit">
            Try again
          </Button>
        </StandaloneMessage>
      );
    case "personal_team_not_active":
      // Deliberately no retry: the membership exists and is not active, and
      // the contract says provisioning will not change that. Only a person can.
      return (
        <StandaloneMessage title="This account cannot claim projects">
          <p className={STANDALONE_BODY}>{outcome.message}</p>
          <p className={STANDALONE_BODY}>{membershipRemedy(outcome.membershipStatus)}</p>
        </StandaloneMessage>
      );
    case "invalid_challenge":
      return (
        <StandaloneMessage title="This claim link is not valid">
          <p className={STANDALONE_BODY}>{outcome.message}</p>
        </StandaloneMessage>
      );
    case "unauthenticated":
      // NOT the sign-in widget again: the server collapses "wrong project" and
      // "no platform project" into one opaque 401, so the page cannot tell
      // which it is, and re-running sign-in against the same project mints the
      // same session. Signing out is what the developer can act on, and it is
      // the common case — a session left over from the app they just scaffolded
      // on this origin. Offering the account a choice is the account-picker
      // story, not this screen.
      return (
        <StandaloneMessage title="This account can't claim the project">
          <p className={STANDALONE_BODY}>
            The account you are signed in with belongs to a different project.
          </p>
          <p className={STANDALONE_BODY}>
            If you signed in to the app you just set up, sign out of it — it shares this address.
            Then reopen the claim link from your terminal to create an account or sign in for this
            project.
          </p>
          <Button onClick={retry} variant="outline" className="mx-auto w-fit">
            Try again
          </Button>
        </StandaloneMessage>
      );
    case "csrf_refused":
      // Still refused after the shared fetch's one retry: someone else is
      // signed in now (the session module may already have reloaded the page),
      // or the request came from another site. Reloading starts over with the
      // session this browser actually holds now.
      return (
        <StandaloneMessage title="The claim was not accepted from this page">
          <p className={STANDALONE_BODY}>{outcome.message}</p>
          <p className={STANDALONE_BODY}>
            Your sign-in may have changed in another tab. Reload this page, or reopen the claim link
            from your terminal.
          </p>
          <Button
            onClick={() => window.location.reload()}
            variant="outline"
            className="mx-auto w-fit"
          >
            Reload
          </Button>
        </StandaloneMessage>
      );
    case "error":
      return (
        <StandaloneMessage title="The claim did not complete">
          <p className={STANDALONE_BODY}>{outcome.message}</p>
          <Button onClick={retry} variant="outline" className="mx-auto w-fit">
            Try again
          </Button>
        </StandaloneMessage>
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
