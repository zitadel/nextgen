import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import type { ReleaseStatus } from "@/lib/release";

/**
 * A release's state pill. `active` is the shared lifecycle pill with its
 * success dot; `revoked` is the design's tinted destructive badge, with no dot,
 * because revocation is a hard stop rather than one state among several.
 */
export function ReleaseStatusBadge({ status }: { status: ReleaseStatus }) {
  if (status === "revoked") return <Badge variant="destructive">Revoked</Badge>;
  return <StatusBadge status="active" />;
}
