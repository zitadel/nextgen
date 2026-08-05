import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * The user status pill, shared by the users list and the user detail screen.
 *
 * `Badge` is the design-system component (`26:169`) and already carries every
 * dimension of the pill — `h-5`, `gap-1`, `px-2 py-0.5`, `rounded-full`,
 * `text-xs font-medium` — so nothing here restates it. What the design adds is
 * the component's own left icon slot (`showLeftIcon`), filled with a dot rather
 * than a glyph.
 *
 * Only `active` carries a colour in the design (`base/success`, on the Active
 * badge at `1140:342940`). Every other status renders a neutral dot rather than
 * inventing a semantic colour the design has not chosen — see the note on #631.
 *
 * `bg-success` rather than Tailwind's own `green-500`: v4 moved its palette to
 * oklch, so `green-500` renders `(0,201,80)` where the design system's value is
 * `(34,197,94)`. The utility no longer matches the token it is named after.
 */
const DOT = "size-2.5 shrink-0 rounded-full";

export function UserStatusBadge({ status }: { status?: string }) {
  // A record written before the server stamped `metadata` simply has none, and
  // an em dash is honest where a pill would imply a state we do not know.
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
