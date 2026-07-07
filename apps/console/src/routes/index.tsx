import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "../components/resource-page";

export const Route = createFileRoute("/")({
  staticData: { nav: { label: "Dashboard", order: 0 } },
  component: Dashboard,
});

function Dashboard() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Manage identities and configuration for your Zitadel project."
      />
      <p className="text-sm text-zl-text-secondary-gray">
        Select a resource from the sidebar to get started.
      </p>
    </>
  );
}
