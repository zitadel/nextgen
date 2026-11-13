import { IdText } from "@/components/id-text";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { type FlowOutcome, type Signin, SIGNIN_OUTCOME_LABEL } from "../model";

/**
 * A user an event names, as what they are called now when that has been read
 * (`useUserNames`), with the ID on hover; until then, or for a user without
 * a name, the ID itself.
 */
export function UserName({
  id,
  names,
  className,
}: {
  id: string;
  names: ReadonlyMap<string, string>;
  className?: string;
}) {
  const name = names.get(id);
  if (!name) return <IdText id={id} title={id} className={cn("text-foreground", className)} />;
  return (
    <span className={cn("text-foreground truncate", className)} title={id}>
      {name}
    </span>
  );
}

/**
 * Who caused an event: a person by name, any other principal by its ID, and
 * a system actor, which has no ID, by its kind.
 */
export function ActorName({
  actorId,
  actorType,
  names,
}: {
  actorId?: string | null;
  actorType?: string | null;
  names: ReadonlyMap<string, string>;
}) {
  if (actorId) return <UserName id={actorId} names={names} className="text-sm" />;
  if (actorType) return <span className="text-foreground text-sm">{actorType}</span>;
  return <span className="text-muted-foreground">—</span>;
}

const OUTCOME_LABEL: Record<Signin["outcome"] | FlowOutcome, string> = {
  ...SIGNIN_OUTCOME_LABEL,
  opened: "Session opened",
  abandoned: "Abandoned",
  in_progress: "In progress",
};

/**
 * How a sign-in ended, as a badge: a failure in the destructive tint, the
 * rest quiet. The word says it; the tint only draws the eye to a failure.
 */
export function OutcomeBadge({ outcome }: { outcome: Signin["outcome"] | FlowOutcome }) {
  return (
    <Badge
      variant={
        outcome === "failed" ? "destructive" : outcome === "signed_in" ? "secondary" : "outline"
      }
    >
      {OUTCOME_LABEL[outcome]}
    </Badge>
  );
}
