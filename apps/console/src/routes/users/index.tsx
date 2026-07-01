import { createFileRoute } from "@tanstack/react-router";

import { api } from "../../api/zitadel";
import {
  CreateButtonStub,
  DataTable,
  PageHeader,
  TableLink,
} from "../../components/resource-page";
import { field } from "../../lib/record";

export const Route = createFileRoute("/users/")({
  staticData: { nav: { group: "Identity", label: "Users", order: 1 } },
  loader: () => api.listUsers(),
  component: UsersList,
});

function UsersList() {
  const users = Route.useLoaderData();

  return (
    <>
      <PageHeader title="Users" action={<CreateButtonStub label="Create user" />} />
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
    </>
  );
}
