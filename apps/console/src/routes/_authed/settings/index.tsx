import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Account settings — where the sidebar's account dropdown lands, and the route
 * that puts the shell into its Settings view.
 *
 * It carries no `staticData.nav` entry on purpose: the design reaches settings
 * from the account dropdown, not from the primary sidebar list, so the route is
 * addressable without being advertised as a nav row (Console ADR 0001).
 *
 * There is no settings landing page to render — the frames always show a
 * screen selected — so `/settings` forwards to the first settings screen. The
 * grouped settings nav itself hangs off the screens' own routes
 * (`nav.section`, see `profile.tsx`).
 */
export const Route = createFileRoute("/_authed/settings/")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/profile" });
  },
});
