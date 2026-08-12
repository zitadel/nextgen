import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * The lifecycle status pill, shared by every resource that has one — users
 * (`active`, `suspended`, `deactivated`, `pending_purge`) and teams (`active`,
 * `deactivated`).
 *
 * `Badge` is the design-system component (`26:169`) and already carries every
 * dimension of the pill — `h-5`, `gap-1`, `px-2 py-0.5`, `rounded-full`,
 * `text-xs font-medium` — so nothing here restates it. What the design adds is
 * the component's own left icon slot (`showLeftIcon`), filled with a dot rather
 * than a glyph.
 *
 * Only `active` carries a colour in the design (`base/success`). Every other
 * status renders a neutral dot rather than inventing a semantic colour the
 * design has not chosen.
 *
 * The label is the API's own value, title-cased. The Teams mock writes the
 * second state as `Inactive`, but the endpoint returns `deactivated` and the
 * team detail reads the same field — showing two words for one state would be
 * the console inventing vocabulary the API does not have.
 *
 * `bg-success` rather than Tailwind's own `green-500`: v4 moved its palette to
 * oklch, so `green-500` renders `(0,201,80)` where the design system's value is
 * `(34,197,94)`. The utility no longer matches the token it is named after.
 */
const DOT = "size-2.5 shrink-0 rounded-full";

export function StatusBadge({ status }: { status?: string }) {
  // A record the server has not stamped simply has no status, and an em dash is
  // honest where a pill would imply a state we do not know.
  if (!status) return <span className="text-muted-foreground">—</span>;

  return (
    <Badge variant="secondary" className="capitalize">
      <span
        aria-hidden
        className={cn(DOT, status === "active" ? "bg-success" : "bg-muted-foreground")}
      />
      {status.replace(/_/g, " ")}
    </Badge>
  );
}
