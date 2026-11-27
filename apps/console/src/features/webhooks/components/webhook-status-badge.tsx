import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";

import { STATE_LABEL, type WebhookState } from "../model";

/**
 * A webhook's state pill. `active` and `disabled` are states like any
 * resource's, with the success and the neutral dot. A webhook whose last
 * attempt failed, retrying or given up on, is the tinted destructive badge
 * with no dot, as a revoked release is: it wants looking at.
 */
export function WebhookStatusBadge({ state }: { state: WebhookState }) {
  if (state === "active" || state === "disabled") return <StatusBadge status={state} />;
  return <Badge variant="destructive">{STATE_LABEL[state]}</Badge>;
}
