import { createFileRoute, redirect } from "@tanstack/react-router";
import { Settings } from "lucide-react";

/**
 * Settings: the account sidebar's row beside Projects, and a route above
 * every project. Everything beneath it is listed in the sidebar's Settings
 * list instead of the account's (D29).
 *
 * It has no page of its own: it forwards to the list's first page, the
 * person's profile. Accounts are not surfaced while the cloud does not use
 * them (Console ADR 0005 §3).
 */
export const Route = createFileRoute("/_authed/settings/")({
  staticData: {
    nav: { label: "Settings", view: "account", order: 9, icon: Settings },
  },
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/settings/profile", search });
  },
});
