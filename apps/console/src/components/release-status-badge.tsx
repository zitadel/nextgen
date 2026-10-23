import { BadgeCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { ReleaseStatus } from "@/lib/release";

/**
 * A release's state pill. `active` carries the check the design gives it, as
 * the revision badges do, rather than the lifecycle dot the directory's rows
 * use; `revoked` is the tinted destructive badge, with no icon, because
 * revocation is a hard stop rather than one state among several.
 */
export function ReleaseStatusBadge({ status }: { status: ReleaseStatus }) {
  if (status === "revoked") return <Badge variant="destructive">Revoked</Badge>;
  return (
    <Badge variant="secondary">
      <BadgeCheck aria-hidden="true" />
      Active
    </Badge>
  );
}
