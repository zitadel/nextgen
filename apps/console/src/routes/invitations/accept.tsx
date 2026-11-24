import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";

import { fetchSession, signOut } from "@/auth/session";
import { lookupStoredInvitation } from "@/features/invitations/api";
import { InvitationPage } from "@/features/invitations/components/invitation-page";
import type { InvitationPageState } from "@/features/invitations/model";
import { handOverInvitationToken, INVITATION_ACCEPT_PATH } from "@/features/invitations/token";

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
 * The loader only looks the invitation up (`lookupStoredInvitation`), which is
 * a read; accepting and declining live in the component, so a loader re-run
 * can never spend the link.
 *
 * The page has no app shell, so it names the account that would join and
 * offers the way to another one itself: sign out, keep the token, and come
 * back here from `/login`.
 */
export const Route = createFileRoute("/invitations/accept")({
  loader: async (): Promise<{ account: string; state: InvitationPageState }> => {
    const session = await fetchSession();
    // `fetchSession` only resolves a session that has a user.
    if (!session?.user_id) {
      throw redirect({ to: "/login", search: { next: INVITATION_ACCEPT_PATH } });
    }
    return {
      // The identifier first: it is what the person signs in with, and two of
      // their accounts may share a display name.
      account: session.user?.identifier ?? session.user?.display ?? session.user_id,
      state: await lookupStoredInvitation(session.user_id),
    };
  },
  // Looked up once per document: the outcome the component reaches (declined,
  // unavailable) must not be replaced by a second lookup of a spent token.
  shouldReload: false,
  component: InvitationScreen,
});

function InvitationScreen() {
  const { account, state } = Route.useLoaderData();
  const router = useRouter();

  const switchAccount = async () => {
    await signOut();
    handOverInvitationToken();
    await router.navigate({ to: "/login", search: { next: INVITATION_ACCEPT_PATH } });
  };

  return <InvitationPage state={state} account={account} onSwitchAccount={switchAccount} />;
}
