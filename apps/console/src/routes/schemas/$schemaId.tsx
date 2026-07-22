import { createFileRoute } from "@tanstack/react-router";

import { api, projectId } from "../../api/zitadel";
import { Page } from "../../components/layout";
import { PageHeader } from "../../components/resource-page";

export const Route = createFileRoute("/schemas/$schemaId")({
  loader: ({ params }) => api.getSchemaById(params.schemaId, { project_id: projectId }),
  component: SchemaDetail,
});

function SchemaDetail() {
  const schema = Route.useLoaderData();
  const { schemaId } = Route.useParams();

  return (
    <Page>
      <PageHeader title="Schema" description={schemaId} />
      {/* prettier-ignore */}
      <pre className="overflow-auto rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground">{JSON.stringify(schema, null, 2)}</pre>
    </Page>
  );
}
