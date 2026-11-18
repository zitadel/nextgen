import { createFileRoute, redirect } from "@tanstack/react-router";

import { api } from "@/api/zitadel";
import { fetchSession } from "@/auth/session";
import {
  InvitationPage,
  type InvitationPageState,
  isInvitationGone,
  isOpen,
} from "@/features/invitations/components/invitation-page";
import {
  clearInvitationToken,
  INVITATION_ACCEPT_PATH,
  readInvitationToken,
} from "@/features/invitations/token";
import { describeError } from "@/lib/api-error";

/**
 * The invitation page (root ADR 086 §3, #2856): where the link
 * `<console>/invitations/accept#token=…` lands.
 *
 * A top-level route outside `_authed` on purpose. The page is for signed-in
 * people only, but the `_authed` guard carries the requested location into
 * `?next=`, and the token must never reach a query string. So the page checks
 * the session itself and sends a signed-out visitor to `/login` with the bare
 * path; signing up happens inside that flow. By then the token is already in
 * `sessionStorage` (`features/invitations/token.ts`, captured before the app
 * boots), which survives the widget's full-page navigation back here.
 *
 * The loader only looks the invitation up, which is a read; accepting and
 * declining live in the component, so a loader re-run can never spend the
 * link.
 */
export const Route = createFileRoute("/invitations/accept")({
  loader: async (): Promise<InvitationPageState> => {
    const session = await fetchSession();
    if (!session) {
      throw redirect({ to: "/login", search: { next: INVITATION_ACCEPT_PATH } });
    }
    const token = readInvitationToken();
    if (!token) return { kind: "unavailable" };
    try {
      const invitation = await api.lookupInvitation({ token });
      if (isOpen(invitation)) return { kind: "open", token, invitation };
    } catch (cause) {
      if (!isInvitationGone(cause)) {
        return {
          kind: "error",
          message: describeError(cause, "The invitation could not be loaded. Try again."),
        };
      }
    }
    // Unknown to the server, or finished: the token is of no further use.
    clearInvitationToken();
    return { kind: "unavailable" };
  },
  // Looked up once per document: the outcome the component reaches (declined,
  // unavailable) must not be replaced by a second lookup of a spent token.
  shouldReload: false,
  component: InvitationScreen,
});

function InvitationScreen() {
  return <InvitationPage state={Route.useLoaderData()} />;
}
