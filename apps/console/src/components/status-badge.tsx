import { Badge } from "@/components/ui/badge";
import type { FilterOption } from "@/lib/resource-filter";
import { cn } from "@/lib/utils";

/**
 * The lifecycle status pill, shared by every resource that has one — users
 * (`active`, `suspended`, `deactivated`, `pending_purge`), teams (`active`,
 * `deactivated`), deployments (`live`, `inactive`) and login flows (`draft`).
 *
 * `Badge` is the design-system component and already carries every
 * dimension of the pill — `h-5`, `gap-1`, `px-2 py-0.5`, `rounded-full`,
 * `text-xs font-medium` — so nothing here restates it. What the design adds is
 * the component's own left icon slot (`showLeftIcon`), filled with a dot rather
 * than a glyph.
 *
 * The dot's colour is the status's tone (`statusTone`), never a colour chosen
 * per status: see "Status tones" in `docs/styling.md` for what each tone means.
 *
 * The label is the API's own value, title-cased (`statusLabel`). The Teams mock writes the
 * second state as `Inactive`, but the endpoint returns `deactivated` and the
 * team detail reads the same field — showing two words for one state would be
 * the console inventing vocabulary the API does not have.
 */

/**
 * What a status means for the thing that carries it, which is all its dot
 * says:
 *
 * - `positive`: in force and working.
 * - `caution`: held for now; someone can lift it.
 * - `critical`: on its way out, and not coming back by itself.
 * - `neutral`: off, or not yet on; nothing is happening.
 */
export type StatusTone = "positive" | "caution" | "critical" | "neutral";

/**
 * Every status the console shows, by tone. A new status is added here, under
 * the tone whose meaning it has; one that is not listed reads `neutral`, since
 * a colour would claim a meaning nobody gave it.
 */
const STATUS_TONE: Record<string, StatusTone> = {
  active: "positive",
  live: "positive",
  suspended: "caution",
  pending_purge: "critical",
  deactivated: "neutral",
  inactive: "neutral",
  draft: "neutral",
};

/** A status's tone; `neutral` for one the console does not know. */
export function statusTone(status: string): StatusTone {
  // Own keys only: a status is the server's string, and `constructor` is not one.
  return Object.hasOwn(STATUS_TONE, status) ? (STATUS_TONE[status] ?? "neutral") : "neutral";
}

/**
 * Each tone's token. `bg-success`, not `green-500`: Tailwind's oklch green
 * renders `(0,201,80)`, the design-system value is `(34,197,94)`.
 */
const TONE_DOT: Record<StatusTone, string> = {
  positive: "bg-success",
  caution: "bg-warning",
  critical: "bg-destructive",
  neutral: "bg-muted-foreground",
};

/** The pill's dot on its own. */
function StatusDot({ status }: { status: string }) {
  const tone = statusTone(status);
  return (
    <span
      aria-hidden
      data-tone={tone}
      className={cn("size-2.5 shrink-0 rounded-full", TONE_DOT[tone])}
    />
  );
}

/** A status in words, for the pill and a filter alike: `pending_purge` → `Pending Purge`. */
function statusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

/**
 * A resource's statuses as a `ResourceFilter`'s options: the pill's dot beside
 * the name, not the pill, whose fill is the popover's own on the dark theme
 * and shows only under a hover.
 */
export function statusOptions(statuses: readonly string[]): FilterOption[] {
  return statuses.map((status) => ({
    value: status,
    label: statusLabel(status),
    content: (
      <span className="flex min-w-0 flex-1 items-center gap-2 leading-5">
        <StatusDot status={status} />
        <span className="truncate">{statusLabel(status)}</span>
      </span>
    ),
  }));
}

export function StatusBadge({ status }: { status?: string }) {
  // A record the server has not stamped simply has no status, and an em dash is
  // honest where a pill would imply a state we do not know.
  if (!status) return <span className="text-muted-foreground">—</span>;

  return (
    <Badge variant="secondary">
      <StatusDot status={status} />
      {statusLabel(status)}
    </Badge>
  );
}
