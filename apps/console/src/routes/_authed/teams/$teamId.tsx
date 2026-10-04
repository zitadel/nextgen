import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Box } from "lucide-react";

import { api } from "@/api/zitadel";
import { MetaRule, MetaValue } from "@/components/detail-meta";
import { DETAIL_BODY, DetailHeader, DetailPage } from "@/components/detail-page";
import { RenameCard } from "@/components/rename-card";
import { StatusBadge } from "@/components/status-badge";
import { formatDate } from "@/lib/date";

/**
 * Team detail.
 *
 * The header card carries `TEAM ID` and `CREATED`. The design draws a third cell,
 * `PRIMARY DOMAIN`, which is deliberately not built: a domain that discovers and
 * claims a team is security-relevant, so it needs its own model — verification,
 * and more than one domain per team — rather than a string on `team-response`.
 * That model is not defined yet, so the cell is left out rather than shown empty.
 */
export const Route = createFileRoute("/_authed/teams/$teamId")({
  staticData: { scope: "project" },
  loader: ({ params }) => api.getTeam(params.teamId),
  component: TeamDetail,
});

function TeamDetail() {
  const team = Route.useLoaderData();
  const router = useRouter();

  return (
    <DetailPage>
      <DetailHeader
        icon={Box}
        title={team.name}
        status={<StatusBadge status={team.status} />}
        meta={
          <>
            <MetaValue label="Team ID" value={team.id} copyable />
            <MetaRule />
            <MetaValue label="Created" value={formatDate(team.created_at)} />
          </>
        }
      />

      {/* `Tenant name` is the design's label for the team's own `name`, the only
          field `PATCH /teams/{team_id}` accepts. Relabelling it `Team name`
          waits on the decisions log's open naming question. */}
      <RenameCard
        id="team-tenant-name"
        label="Tenant name"
        value={team.name}
        record={team}
        onSave={async (name) => {
          await api.updateTeam(team.id, { name });
          await router.invalidate();
        }}
        errorFallback="Could not save the team."
        className={DETAIL_BODY}
      />
    </DetailPage>
  );
}
