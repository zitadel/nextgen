import { Link } from "@tanstack/react-router";
import { Box } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { UserTeam } from "@/features/users/model";

/**
 * The teams a user belongs to, glyphed the way the design draws the cell and the
 * way the Teams directory draws a team row. A membership that is not active yet
 * (`pending`) or any more (`inactive`) says so: the roster returns them beside
 * the active ones, and an unmarked name would read as a full member.
 *
 * Each name opens its team, as the Teams directory's own rows do — the embedded
 * entry carries the id, so the link costs no extra read.
 *
 * `+more` is deliberately not a link. The response carries the capped list and a
 * boolean, not the names past the cap, so there is nothing to expand inline
 * without the per-row roster read that `expand` exists to avoid; and the user
 * detail screen does not render teams yet (decisions log D3), so there is no
 * screen to send the operator to. It becomes a link to that screen when the
 * screen lists them.
 */
export function TeamCell({ teams, truncated }: { teams: UserTeam[]; truncated: boolean }) {
  if (teams.length === 0) return <>—</>;
  return (
    <span className="flex items-center gap-1.5">
      <Box aria-hidden strokeWidth={1.5} className="size-3.5 shrink-0" />
      {/* The names truncate; the marker does not. Inside the truncating span it
          is the first thing CSS clips — and a roster long enough to overflow is
          exactly the one that has more teams to report. */}
      <span className="truncate">
        {teams.map((team, index) => (
          <span key={team.id}>
            {/* The separator sits outside the anchor: it belongs to the list,
                not to either team it divides. */}
            {index > 0 && ", "}
            <Link
              to="/teams/$teamId"
              params={{ teamId: team.id }}
              className="hover:text-foreground underline-offset-2 hover:underline"
            >
              {team.name}
            </Link>
            {team.status && team.status !== "active" && (
              <Badge
                variant="outline"
                className="text-muted-foreground ml-1 h-4 rounded-sm border-dashed px-1 align-middle text-[11px] font-normal"
              >
                {team.status}
              </Badge>
            )}
          </span>
        ))}
      </span>
      {truncated && <span className="shrink-0">+more</span>}
    </span>
  );
}
