import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Account settings — where the sidebar's account dropdown lands, and the route
 * that puts the shell into its Settings view.
 *
 * It carries no `staticData.nav` entry on purpose: the design reaches settings
 * from the account dropdown, not from the primary sidebar list, so the route is
 * addressable without being advertised as a nav row (Console ADR 0001).
 *
 * The design draws no settings landing screen, so this lands on the first row of
 * the settings nav rather than rendering a page of its own. `ACCOUNT / Profile`
 * sits above `WORKSPACE / Admins` and is the better target, but it needs a call
 * that updates a user (#693) and is not built; move the target up with it.
 */
export const Route = createFileRoute("/_authed/settings/")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/admins" });
  },
});
