import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import type { ReleaseStatus } from "@/lib/release";

/**
 * A release's state pill. Whether an origin serves the release is said in
 * the deployment vocabulary the directory's rows use, `live` with the
 * success dot and `inactive` with the neutral one, so the header and the
 * rows under it agree. `revoked` is the tinted destructive badge, with no
 * dot, because revocation is a hard stop rather than one state among several.
 */
export function ReleaseStatusBadge({
  status,
  live,
}: {
  status: ReleaseStatus;
  /** Whether any deployment of the release is live. */
  live: boolean;
}) {
  if (status === "revoked") return <Badge variant="destructive">Revoked</Badge>;
  return <StatusBadge status={live ? "live" : "inactive"} />;
}
