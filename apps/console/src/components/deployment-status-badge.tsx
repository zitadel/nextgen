import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import type { Deployment } from "@/lib/deployment";

/** Whether any origin still serves the deployment: live, or superseded. */
export function DeploymentStatusBadge({ status }: { status: Deployment["status"] }) {
  return status === "live" ? (
    <StatusBadge status="active" />
  ) : (
    <Badge variant="secondary">Superseded</Badge>
  );
}
