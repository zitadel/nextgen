import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Account settings — where the sidebar's account dropdown lands, and the route
 * that puts the shell into its Settings view.
 *
 * It carries no `staticData.nav` entry on purpose: the design reaches settings
 * from the account dropdown, not from the primary sidebar list, so the route is
 * addressable without being advertised as a nav row (Console ADR 0001).
 *
 * `/settings` itself is not a screen: it lands on `ACCOUNT / Profile`, the first
 * row of the Settings nav (Figma `Settings Page / Profile`, 1556:87256).
 */
export const Route = createFileRoute("/_authed/settings/")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/profile", replace: true });
  },
});
