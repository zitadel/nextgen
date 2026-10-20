import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Account settings: where the sidebar's account dropdown lands, and the route
 * that puts the shell into its Settings view.
 *
 * It carries no `staticData.nav` entry on purpose: the design reaches settings
 * from the account dropdown, not from the primary sidebar list, so the route is
 * addressable without being advertised as a nav row (Console ADR 0001).
 *
 * Settings has no landing page of its own, so this forwards to its first
 * screen.
 */
export const Route = createFileRoute("/_authed/settings/")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/settings/profile", search });
  },
});
