import { Navigate, createFileRoute } from "@tanstack/react-router";
import { Settings } from "lucide-react";

import { useNavItems } from "@/app-shell/use-nav-items";
import { Page } from "@/components/layout";
import { PageHeader } from "@/components/resource-page";

/**
 * Settings: the account sidebar's row beside Projects, and a route above
 * every project. Everything beneath it is listed in the sidebar's Settings
 * list instead of the account's (D29): what the hosted cloud adds (Billing,
 * Support, Email). The platform project's pages are the root sidebar's own
 * rows, not Settings', and the person's profile is the account menu's, at
 * `/account` (D41).
 *
 * It has no page of its own: it forwards to the list's first page. With
 * nothing in the list the sidebar leaves the row out, and a link that still
 * lands here says so.
 */
export const Route = createFileRoute("/_authed/settings/")({
  staticData: {
    nav: { label: "Settings", view: "account", order: 9, icon: Settings },
  },
  component: SettingsLanding,
});

function SettingsLanding() {
  const [first] = useNavItems("settings");
  if (first) return <Navigate to={first.to} replace />;
  return (
    <Page>
      <PageHeader title="Settings" description="Nothing here is yours to set." />
    </Page>
  );
}
