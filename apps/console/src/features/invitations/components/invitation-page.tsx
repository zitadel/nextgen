import { Link, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

import { trackEvent } from "@/addon/analytics";
import { api } from "@/api/zitadel";
import { FormError } from "@/components/form-error";
import { StandaloneScreen } from "@/components/standalone-screen";
import { SECTION_HEADING } from "@/components/typography";
import { Button } from "@/components/ui/button";
import { useSubmit } from "@/hooks/use-submit";
import { errorCode } from "@/lib/api-error";
import { clearSessionCaches } from "@/lib/session-cache";

import {
  analyticsRole,
  describeExpiry,
  effectiveStatus,
  type InvitationLookup,
  inviterLabel,
  roleInProse,
} from "../model";
import { clearInvitationToken } from "../token";

/** What the page found for the link it was opened with. */
export type InvitationPageState =
  /** A pending invitation, and the token that spends it. */
  | { kind: "open"; token: string; invitation: InvitationLookup }
  /** No token, an unknown one, or an invitation that is finished. */
  | { kind: "unavailable" }
  /** The lookup failed for another reason; the token is kept for a retry. */
  | { kind: "error"; message: string };

/** The API's one answer for every unknown or finished token (root ADR 086 §10). */
const NOT_FOUND = "inv.not_found";

/** Whether a failed call says the link is finished, rather than that the call failed. */
export function isInvitationGone(cause: unknown): boolean {
  return errorCode(cause) === NOT_FOUND;
}

/**
 * The page an invitation link opens (root ADR 086 §3, #2856), for a signed-in
 * colleague: what they are invited to, then **Join project** or **Decline
 * invitation**.
 *
 * **One message for every dead link.** The server answers an unknown, expired,
 * accepted, declined and cancelled token alike, so that holding a token never
 * tells anyone what became of an invitation; the page says `Invitation
 * unavailable` for all of them, and for a lookup that names a status other
 * than `pending`. The design's `Invitation already accepted` state has nothing
 * to tell it apart from the rest.
 *
 * **The token leaves with the outcome.** Accepting, declining and a token the
 * server no longer knows all clear it from storage. A failure of any other
 * kind keeps it, so reloading the page or reopening the link picks up where
 * it stopped.
 *
 * **The inviter is the lookup's.** `inviter` is a user-ref the server resolves,
 * because the invited person cannot read the project's users; the page shows
 * it as it arrives and never looks anyone up by id. An invitation a project
 * secret created has none, and the line is left out.
 */
export function InvitationPage({ state }: { state: InvitationPageState }) {
  const [outcome, setOutcome] = useState<"declined" | "gone" | undefined>(undefined);

  if (state.kind === "error") {
    return (
      <InvitationShell>
        <StatusCard title="Invitation could not be loaded">
          <FormError message={state.message} />
        </StatusCard>
      </InvitationShell>
    );
  }

  if (state.kind === "unavailable" || outcome === "gone") {
    return (
      <InvitationShell>
        <StatusCard title="Invitation unavailable">
          <p className={BODY}>
            This link is no longer valid. Ask a project admin for a new invitation.
          </p>
        </StatusCard>
      </InvitationShell>
    );
  }

  const { invitation, token } = state;

  if (outcome === "declined") {
    return (
      <InvitationShell>
        <StatusCard title="Invitation declined">
          <p className={BODY}>You haven&apos;t joined {invitation.project_name}.</p>
          <Button asChild className="w-full px-2.5">
            <Link to="/projects">Go to projects</Link>
          </Button>
        </StatusCard>
      </InvitationShell>
    );
  }

  return (
    <InvitationShell>
      <OpenInvitation
        token={token}
        invitation={invitation}
        onDeclined={() => setOutcome("declined")}
        onGone={() => setOutcome("gone")}
      />
    </InvitationShell>
  );
}

const BODY = "text-muted-foreground text-sm leading-5";

/** The card every state of the page is: a hairline box in the standalone column. */
const CARD =
  "border-foreground/10 bg-background flex w-full max-w-md flex-col rounded-md border p-6";

function InvitationShell({ children }: { children: ReactNode }) {
  return <StandaloneScreen>{children}</StandaloneScreen>;
}

/** A finished state: the title over what it means and, where there is one, the way on. */
function StatusCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={`${CARD} gap-4`}>
      <h1 className="text-foreground font-serif text-sm leading-5">{title}</h1>
      {children}
    </div>
  );
}

function OpenInvitation({
  token,
  invitation,
  onDeclined,
  onGone,
}: {
  token: string;
  invitation: InvitationLookup;
  onDeclined: () => void;
  onGone: () => void;
}) {
  const navigate = useNavigate();

  /** Clears the token for a link the server says is finished; rethrows the rest. */
  function finishedOr(cause: unknown): never | undefined {
    if (!isInvitationGone(cause)) throw cause;
    clearInvitationToken();
    onGone();
    return undefined;
  }

  const accept = useSubmit(async () => {
    let accepted: Awaited<ReturnType<typeof api.acceptInvitation>>;
    try {
      accepted = await api.acceptInvitation({ token });
    } catch (cause) {
      return finishedOr(cause);
    }
    clearInvitationToken();
    trackEvent("invitation_accepted", {
      role: analyticsRole(accepted),
      invitation_journey_id: accepted.journey_id,
    });
    // The person's projects are cached for the shell; the one just joined is
    // not in that answer.
    clearSessionCaches();
    toast.success(`You joined ${invitation.project_name}`);
    await navigate({ to: "/projects" });
  }, "Could not accept the invitation. Try again.");

  const decline = useSubmit(async () => {
    let rejected: Awaited<ReturnType<typeof api.rejectInvitation>>;
    try {
      rejected = await api.rejectInvitation({ token });
    } catch (cause) {
      return finishedOr(cause);
    }
    clearInvitationToken();
    trackEvent("invitation_rejected", {
      role: analyticsRole(rejected),
      invitation_journey_id: rejected.journey_id,
    });
    onDeclined();
  }, "Could not decline the invitation. Try again.");

  const busy = accept.pending || decline.pending;
  const inviter = inviterLabel(invitation);

  return (
    <div className={`${CARD} gap-5`}>
      <div className="flex flex-col gap-2">
        <h1 className={`${SECTION_HEADING} wrap-anywhere`}>
          You&apos;re invited to join {invitation.project_name}
        </h1>
        {inviter && <p className={`${BODY} wrap-anywhere`}>Invited by {inviter}</p>}
        <p className={BODY}>
          You&apos;ll join as {roleInProse(invitation)}. {describeExpiry(invitation.expires_at)}.
        </p>
      </div>
      <FormError message={accept.error ?? decline.error} />
      <div className="flex flex-col items-center gap-2">
        <Button
          className="w-full px-2.5"
          loading={accept.pending}
          disabled={busy}
          onClick={() => void accept.run()}
        >
          Join project
        </Button>
        <Button
          variant="link"
          className="text-muted-foreground px-2.5"
          loading={decline.pending}
          disabled={busy}
          onClick={() => void decline.run()}
        >
          Decline invitation
        </Button>
      </div>
    </div>
  );
}

/** Whether a looked-up invitation can still be acted on. */
export function isOpen(invitation: InvitationLookup): boolean {
  return effectiveStatus(invitation) === "pending";
}
