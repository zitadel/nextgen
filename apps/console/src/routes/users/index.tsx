import { createFileRoute } from "@tanstack/react-router";
import { UserRound } from "lucide-react";

import { api } from "../../api/zitadel";
import { Page } from "../../components/layout";
import { DataTable, PageHeader, TableLink } from "../../components/resource-page";
import { field } from "../../lib/record";

export const Route = createFileRoute("/users/")({
  staticData: { nav: { label: "Users", order: 2, icon: UserRound, count: "1,000,000" } },
  loader: () => api.listUsers(),
  component: UsersList,
});

function UsersList() {
  const users = Route.useLoaderData();

  return (
    <Page>
      {/* action parked: "Create user" is a disabled stub with no backing form. */}
      <PageHeader title="Users" />
      <DataTable
        rows={users}
        getRowKey={(user, index) => field(user, "id") ?? `user-${index}`}
        emptyMessage="No users yet."
        columns={[
          {
            header: "Username",
            cell: (user) => {
              const id = field(user, "id");
              const label = field(user, "username") ?? field(user, "email") ?? id ?? "—";
              return id ? (
                <TableLink to="/users/$userId" params={{ userId: id }}>
                  {label}
                </TableLink>
              ) : (
                label
              );
            },
          },
          { header: "Email", cell: (user) => field(user, "email") ?? "—" },
          { header: "Created", cell: (user) => field(user, "created_at") ?? "—" },
        ]}
      />
    </Page>
  );
}
