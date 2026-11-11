import { createFileRoute, redirect } from "@tanstack/react-router";
import { fetchSession, sanitizeNextPath } from "@/auth/session";
import { SignInScreen } from "@/features/sign-in/components/sign-in-screen";
import { stringParam } from "@/lib/search-params";
import { exchangeLinkHandoff, isLoopbackConsole } from "@/features/sign-in/link-handoff";

/**
 * Console sign-in screen (Console ADR 0003): the widget on its `login`
 * purpose (`SignInScreen`, which says how the widget is configured).
 *
 * `?next=` carries the router-relative path the `_authed` guard intercepted;
 * it is sanitized against open redirects before the screen joins it with the
 * deployment prefix.
 */
export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { next?: string; handoff?: string } => ({
    next: sanitizeNextPath(stringParam(search.next)),
    handoff: stringParam(search.handoff),
  }),
  beforeLoad: async ({ search }) => {
    // A sign-in link (`/login?handoff=<token>`) printed by the CLI carries a
    // one-time handoff token; trade it for the session cookie before deciding
    // whether to show the widget. Only on a loopback console: the link is a
    // bearer credential for whoever minted it, so honouring it on a deployed
    // console would let a crafted link silently sign a visitor into the
    // link-maker's session. Minting one requires an account on the server that
    // issued it, which for a developer's own local instance is the developer.
    if (search.handoff && isLoopbackConsole()) {
      await exchangeLinkHandoff(search.handoff);
    }
    const session = await fetchSession();
    if (session) {
      // Already signed in — skip the widget. `next` is router-relative by
      // construction; the cast widens the typed `to` union for the dynamic
      // value (the router resolves plain paths at runtime).
      throw redirect({ to: (search.next ?? "/") as "/" });
    }
  },
  component: LoginScreen,
});

function LoginScreen() {
  const { next } = Route.useSearch();
  return (
    <SignInScreen
      purpose="login"
      title="Sign in to the Zitadel console"
      description="Where you manage your Zitadel projects. Your app's users sign in through your app, not here."
      next={next}
    />
  );
}
