import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Box } from "lucide-react";

import { api } from "@/api/zitadel";
import { MetaRule, MetaValue } from "@/components/detail-meta";
import { DETAIL_BODY, DetailHeader } from "@/components/detail-page";
import { Page } from "@/components/layout";
import { RenameCard } from "@/components/rename-card";
import { StatusBadge } from "@/components/status-badge";
import { TeamUsers } from "@/components/team-users";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { nullOnForbidden } from "@/lib/api-error";
import { formatDate } from "@/lib/date";
import { projectScopeDeps, requireProjectScope } from "@/lib/project-scope";
import { fetchTeamUsers } from "@/lib/team-users";

/**
 * Team detail: a resource inside Teams, not a scope of its own. The sidebar
 * keeps the project's nav with Teams marked, and the team's sections are tabs,
 * as on user detail. A team becomes a sidebar scope once it owns configuration
 * (Console ADR 0005).
 *
 * The header card carries `TEAM ID` and `CREATED`. The design draws a third cell,
 * `PRIMARY DOMAIN`, which is deliberately not built: a domain that discovers and
 * claims a team is security-relevant, so it needs its own model — verification,
 * and more than one domain per team — rather than a string on `team-response`.
 * That model is not defined yet, so the cell is left out rather than shown empty.
 *
 * Members and Owned are the two relations ADR 024 keeps apart — who
 * collaborates in the team, and whose lifecycle it owns — each its own query.
 */
export const Route = createFileRoute("/_authed/teams/$teamId")({
  staticData: { scope: "project" },
  loaderDeps: projectScopeDeps,
  loader: async ({ params, deps }) => {
    const projectId = requireProjectScope(deps.project);
    const [team, members, owned] = await Promise.all([
      api.getTeam(params.teamId),
      // Listing members needs `team_membership.read`, which a grant on only
      // part of the project does not carry: a refusal costs the Members tab
      // its list, not the team its page.
      nullOnForbidden(fetchTeamUsers(projectId, params.teamId, "members")),
      nullOnForbidden(fetchTeamUsers(projectId, params.teamId, "owned")),
    ]);
    return { team, members, owned };
  },
  component: TeamDetail,
});

function TeamDetail() {
  const { team, members, owned } = Route.useLoaderData();
  const router = useRouter();

  return (
    <Page>
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

      <Tabs defaultValue="overview" className={`${DETAIL_BODY} gap-6`}>
        <TabsList aria-label="Team detail sections">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="owned">Owned</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          {/* `Tenant name` is the design's label for the team's own `name`, the only
              field `PATCH /teams/{team_id}` accepts. Relabelling it `Team name`
              waits on the decisions log's open naming question. */}
          <RenameCard
            id="team-tenant-name"
            label="Tenant name"
            value={team.name}
            onSave={async (name) => {
              await api.updateTeam(team.id, { name });
              await router.invalidate();
            }}
            errorFallback="Could not save the team."
          />
        </TabsContent>

        <TabsContent value="members">
          {members ? (
            <TeamUsers
              team={team}
              relation="members"
              loaded={members}
              onChanged={() => router.invalidate()}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Your access does not include this team&apos;s members.
            </p>
          )}
        </TabsContent>

        <TabsContent value="owned">
          {owned ? (
            <TeamUsers
              team={team}
              relation="owned"
              loaded={owned}
              onChanged={() => router.invalidate()}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Your access does not include the users this team owns.
            </p>
          )}
        </TabsContent>
      </Tabs>
    </Page>
  );
}
