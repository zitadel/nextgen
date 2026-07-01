import { createFileRoute } from "@tanstack/react-router";
import { Alert } from "@zitadel/ui-react";

import { PageHeader } from "../../components/resource-page";

export const Route = createFileRoute("/teams/")({
  staticData: { nav: { group: "Identity", label: "Teams", order: 2 } },
  component: TeamsPlaceholder,
});

function TeamsPlaceholder() {
  return (
    <>
      <PageHeader title="Teams" />
      <Alert severity="info" heading="Not available yet">
        The API does not expose a team list endpoint yet. This page is a placeholder until it does.
      </Alert>
    </>
  );
}
