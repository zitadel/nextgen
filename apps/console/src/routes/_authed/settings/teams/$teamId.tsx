import { createFileRoute, useRouter } from "@tanstack/react-router";
import { ApiError } from "@zitadel/api/runtime/fetch";

import { api } from "@/api/zitadel";
import { DETAIL_BODY, DETAIL_TITLE } from "@/components/detail-page";
import { Page, SettingsColumn } from "@/components/layout";
import { RenameCard } from "@/components/rename-card";
import { EYEBROW, PAGE_TITLE_ROW } from "@/components/typography";
import { readAccountTeam } from "@/lib/account";

/**
 * One of the person's teams, opened from Overview, which nests it in the
 * sidebar; the `Team` eyebrow says what the title names. Its settings are its
 * name, the only field `PATCH /teams/{team_id}` accepts. Their own account
 * team grants them the rename (#1890); a team they were only added to answers
 * the read with 403, and the screen says so rather than offering a field that
 * cannot save.
 */
export const Route = createFileRoute("/_authed/settings/teams/$teamId")({
  loader: async ({ params }) => {
    try {
      return { team: await api.getTeam(params.teamId) };
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 403) return { team: null };
      throw cause;
    }
  },
  component: TeamSettingsScreen,
});

function TeamSettingsScreen() {
  const { team } = Route.useLoaderData();
  const router = useRouter();

  return (
    <Page>
      <SettingsColumn>
        <p className={EYEBROW}>Team</p>
        <div className={PAGE_TITLE_ROW}>
          {/* A personal team's generated name can run long: it truncates, with
              the whole name as the tooltip. `py-1` keeps the descenders inside
              the clipped box, which the 24px line height would cut. */}
          <h1 className={`${DETAIL_TITLE} min-w-0 truncate py-1`} title={team?.name}>
            {team?.name ?? "Team"}
          </h1>
        </div>
        {team ? (
          <RenameCard
            id="team-settings-name"
            label="Team name"
            value={team.name}
            onSave={async (name) => {
              await api.updateTeam(team.id, { name });
              // Re-read here and in the sidebar footer, which names the account.
              readAccountTeam.clear();
              await router.invalidate();
            }}
            errorFallback="Could not save the team name."
            className={DETAIL_BODY}
          />
        ) : (
          <p className={`${DETAIL_BODY} text-sm text-muted-foreground`}>
            Only the team&apos;s owners can change its settings.
          </p>
        )}
      </SettingsColumn>
    </Page>
  );
}
