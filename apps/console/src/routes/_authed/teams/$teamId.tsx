import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Box } from "lucide-react";
import { api } from "@/api/zitadel";
import { MetaRule, MetaValue } from "@/components/detail-meta";
import { DETAIL_BODY, DETAIL_STACK, DetailHeader } from "@/components/detail-page";
import { Page } from "@/components/layout";
import { RenameCard } from "@/components/rename-card";
import { StatusBadge } from "@/components/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { nullOnForbidden } from "@/lib/api-error";
import { formatDate } from "@/lib/date";
import { projectScopeDeps, requireProjectScope } from "@/features/projects/project-scope";
import { Members, fetchMembers } from "@/features/teams/components/team-members";

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
 */
export const Route = createFileRoute("/_authed/teams/$teamId")({
  staticData: { scope: "project", resource: "team" },
  loaderDeps: projectScopeDeps,
  loader: async ({ params, deps }) => {
    const projectId = requireProjectScope(deps.project);
    const [team, members] = await Promise.all([
      api.getTeam(params.teamId),
      // Listing members needs `team_membership.read`, which a grant on only
      // part of the project does not carry: a refusal costs the Members tab
      // its list, not the team its page.
      nullOnForbidden(fetchMembers(projectId, params.teamId)),
    ]);
    return { team, members };
  },
  component: TeamDetail,
});

function TeamDetail() {
  const { team, members } = Route.useLoaderData();
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

      <Tabs defaultValue="overview" className={`${DETAIL_BODY} ${DETAIL_STACK}`}>
        <TabsList aria-label="Team detail sections">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          {/* The team's own `name`, the only field `PATCH /teams/{team_id}` accepts. */}
          <RenameCard
            id="team-detail-name"
            label="Team name"
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
            <Members teamId={team.id} loaded={members} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Your access does not include this team&apos;s members.
            </p>
          )}
        </TabsContent>
      </Tabs>
    </Page>
  );
}
