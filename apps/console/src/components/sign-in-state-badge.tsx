import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Whether a sign-in method is on for a schema: the pill at the end of each row
 * of the Authentication screen's per-schema view.
 *
 * The same dotted `secondary` pill as `StatusBadge`, with `base/success` for
 * the one positive state — the V1 frame paints a solid green fill there, but
 * that fill is a raw hex outside the token set, and the console already has a
 * pill for "this is on". `missing` is a listed provider with no connection
 * behind it: a configuration error, so it takes the tinted destructive pill.
 */
export type SignInState = "enabled" | "disabled" | "missing";

const LABELS: Record<SignInState, string> = {
  enabled: "Enabled",
  disabled: "Disabled",
  missing: "No connection",
};

const DOT = "size-2.5 shrink-0 rounded-full";

export function SignInStateBadge({ state }: { state: SignInState }) {
  if (state === "missing") return <Badge variant="destructive">{LABELS.missing}</Badge>;
  return (
    <Badge variant="secondary">
      <span
        aria-hidden
        className={cn(DOT, state === "enabled" ? "bg-success" : "bg-muted-foreground")}
      />
      {LABELS[state]}
    </Badge>
  );
}
