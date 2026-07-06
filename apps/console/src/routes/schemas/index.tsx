import { createFileRoute } from "@tanstack/react-router";
import { Alert } from "@zitadel/ui-react";

import { PageHeader } from "../../components/resource-page";

export const Route = createFileRoute("/schemas/")({
  staticData: { nav: { group: "Configuration", label: "Schemas", order: 3 } },
  component: SchemasPlaceholder,
});

function SchemasPlaceholder() {
  return (
    <>
      <PageHeader title="Schemas" />
      <Alert severity="info" heading="Not available yet">
        The API does not expose a schema list endpoint yet. This page is a placeholder until it
        does.
      </Alert>
    </>
  );
}
