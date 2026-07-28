import { createFileRoute } from "@tanstack/react-router";

import { ComingSoon } from "../../../components/coming-soon";

export const Route = createFileRoute("/_authed/schemas/")({
  component: SchemasPlaceholder,
});

function SchemasPlaceholder() {
  return (
    <ComingSoon
      title="Schemas"
      description="The API exposes a single-schema fetch but no schema list endpoint yet, so there is nothing to browse here. Individual schemas are reachable by URL at /schemas/{id}."
    />
  );
}
