import { createFileRoute } from "@tanstack/react-router";
import { Alert } from "@zitadel/ui-react";

import { api } from "../../api/zitadel";
import { PageHeader } from "../../components/resource-page";

export const Route = createFileRoute("/system/")({
  staticData: { nav: { group: "Configuration", label: "System", order: 4 } },
  loader: async () => {
    // `getHealth` resolves on a healthy server and throws ApiError otherwise;
    // the error boundary renders the unhealthy state.
    await api.getHealth();
    return { healthy: true } as const;
  },
  component: SystemHealth,
});

function SystemHealth() {
  return (
    <>
      <PageHeader title="System" description="Server health" />
      <Alert severity="success" heading="Healthy">
        The Zitadel server is responding to health checks.
      </Alert>
    </>
  );
}
