import { useRouter } from "@tanstack/react-router";
import { createFileRoute } from "@tanstack/react-router";
import { Button, Pill } from "@zitadel/ui-react";
import { useState } from "react";

import { api, projectId } from "../../api/zitadel";
import { DataTable, PageHeader } from "../../components/resource-page";

export const Route = createFileRoute("/sessions/")({
  staticData: { nav: { group: "Identity", label: "Sessions", order: 3 } },
  loader: () => api.listSessions({ project_id: projectId }),
  component: SessionsList,
});

function SessionsList() {
  const { sessions } = Route.useLoaderData();
  const router = useRouter();
  const [revoking, setRevoking] = useState<string | null>(null);

  async function revoke(sessionId: string) {
    setRevoking(sessionId);
    try {
      await api.revokeSession(sessionId, { project_id: projectId });
      await router.invalidate();
    } catch (error) {
      console.error("Failed to revoke session", error);
    } finally {
      setRevoking(null);
    }
  }

  return (
    <>
      <PageHeader title="Sessions" />
      <DataTable
        rows={sessions}
        getRowKey={(session) => session.session_id}
        emptyMessage="No active sessions."
        columns={[
          { header: "Session", cell: (session) => session.session_id },
          { header: "User", cell: (session) => session.user_id ?? "anonymous" },
          {
            header: "State",
            cell: (session) => (
              <Pill tone={session.state === "active" ? "success" : "neutral"}>{session.state}</Pill>
            ),
          },
          { header: "Created", cell: (session) => session.created_at },
          { header: "Expires", cell: (session) => session.expires_at },
          {
            header: "",
            cell: (session) => (
              <Button
                hierarchy="text"
                size="small"
                loading={revoking === session.session_id}
                onClick={() => void revoke(session.session_id)}
              >
                Revoke
              </Button>
            ),
          },
        ]}
      />
    </>
  );
}
