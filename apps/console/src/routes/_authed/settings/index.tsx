import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Account settings: where the account dropdown leads, and the route that puts
 * the shell into its Settings view.
 *
 * It carries no `staticData.nav` entry and no page of its own: Settings (the
 * person's profile) is the only screen, so this forwards to it. Accounts are
 * not surfaced while the cloud does not use them (Console ADR 0005 §3).
 */
export const Route = createFileRoute("/_authed/settings/")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/settings/profile", search });
  },
});
