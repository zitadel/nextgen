import { createFileRoute } from "@tanstack/react-router";
import { Alert } from "@zitadel/ui-react";

import { api } from "../../../api/zitadel";
import { Page } from "../../../components/layout";
import { PageHeader } from "../../../components/resource-page";

export const Route = createFileRoute("/_authed/system/")({
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
    <Page>
      <PageHeader title="System" description="Server health" />
      <Alert severity="success" heading="Healthy">
        The Zitadel server is responding to health checks.
      </Alert>
    </Page>
  );
}
