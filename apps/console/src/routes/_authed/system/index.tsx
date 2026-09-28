import { createFileRoute } from "@tanstack/react-router";
import { CircleCheck } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

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
      {/* `default` rather than a success variant: the design system's Alert ships
          `default` and `destructive` only, and the check glyph carries the state. */}
      <Alert>
        <CircleCheck aria-hidden />
        <AlertTitle>Healthy</AlertTitle>
        <AlertDescription>The Zitadel server is responding to health checks.</AlertDescription>
      </Alert>
    </Page>
  );
}
