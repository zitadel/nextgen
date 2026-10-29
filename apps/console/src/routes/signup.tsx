import { createFileRoute, redirect } from "@tanstack/react-router";

import { fetchSession, sanitizeNextPath } from "@/auth/session";
import { SignInScreen } from "@/components/sign-in-screen";
import { stringParam } from "@/lib/search-params";

/**
 * Console sign-up screen: the sign-in widget on its `register` purpose, so a
 * link can start at creating an account (root ADR 083 §3). It offers what the
 * project's flow offers, so a flow without sign-up refuses it in the widget.
 *
 * Nothing links here: the hosted cloud's public sign-up waits for email
 * verification, and until then this is the address to show the flow. The
 * login page's "Sign up" link is the flow's own, not the console's.
 *
 * A signed-in visitor goes on to `?next=`, sanitized as on `/login`.
 */
export const Route = createFileRoute("/signup")({
  validateSearch: (search: Record<string, unknown>): { next?: string } => ({
    next: sanitizeNextPath(stringParam(search.next)),
  }),
  beforeLoad: async ({ search }) => {
    if (await fetchSession()) {
      // `next` is router-relative by construction; the cast widens the typed
      // `to` union for the dynamic value, as on `/login`.
      throw redirect({ to: (search.next ?? "/") as "/" });
    }
  },
  component: SignUpScreen,
});

function SignUpScreen() {
  const { next } = Route.useSearch();
  return <SignInScreen purpose="register" heading="Create your Zitadel account" next={next} />;
}
