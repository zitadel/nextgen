import { StatusBadge } from "@/components/status-badge";
import type { Deployment } from "@/lib/deployment";

/**
 * Whether any origin still serves the deployment, in the API's own words:
 * `live` with the success dot, `inactive` with the neutral one. The design's
 * frame writes `Superseded`, but `inactive` also covers a preview that
 * expired, so the API's word is the honest one.
 */
export function DeploymentStatusBadge({ status }: { status: Deployment["status"] }) {
  return <StatusBadge status={status} />;
}
