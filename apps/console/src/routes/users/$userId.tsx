import { createFileRoute } from "@tanstack/react-router";

import { api, projectId } from "../../api/zitadel";
import { Page } from "../../components/layout";
import { KeyValueTable, PageHeader } from "../../components/resource-page";
import { field } from "../../lib/record";

export const Route = createFileRoute("/users/$userId")({
  loader: ({ params }) => api.getUserByID(params.userId, { project_id: projectId }),
  component: UserDetail,
});

function UserDetail() {
  const user = Route.useLoaderData();
  const { userId } = Route.useParams();
  const title = field(user, "username") ?? field(user, "email") ?? userId;

  return (
    <Page>
      <PageHeader title={title} description={`User ${userId}`} />
      <KeyValueTable
        rows={Object.entries(user).map(([key, value]) => [
          key,
          typeof value === "string" ? value : JSON.stringify(value),
        ])}
      />
    </Page>
  );
}
