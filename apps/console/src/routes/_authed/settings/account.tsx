import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Building2 } from "lucide-react";

import { DETAIL_TITLE } from "@/components/detail-page";
import { Page, SettingsColumn } from "@/components/layout";
import { PAGE_TITLE_ROW } from "@/components/typography";
import { RenameCard } from "@/components/rename-card";

import { api } from "@/api/zitadel";
import { fetchSession } from "@/auth/session";
import { readAccountTeam, refreshAccountTeam } from "@/lib/account";

/**
 * Settings → Account: the name of the account the signed-in person works in —
 * their team in the sign-in project (`lib/account.ts`), which the sidebar
 * footer shows under the person.
 *
 * The name is the only field `PATCH /teams/{team_id}` accepts, so the screen is
 * the rename card alone. A person on no team has no account to name, and the
 * screen says so rather than rendering an empty field.
 */
export const Route = createFileRoute("/_authed/settings/account")({
  staticData: {
    nav: { label: "Account", order: 0, icon: Building2, view: "settings", group: "WORKSPACE" },
  },
  loader: async () => {
    // The `_authed` guard has just confirmed the session, so this is its cache.
    const userId = (await fetchSession())?.user_id;
    return { team: userId ? await readAccountTeam(userId) : null };
  },
  component: AccountScreen,
});

function AccountScreen() {
  const { team } = Route.useLoaderData();
  const router = useRouter();

  return (
    <Page>
      <SettingsColumn>
        <div className={PAGE_TITLE_ROW}>
          <h1 className={DETAIL_TITLE}>Account</h1>
        </div>
        {team ? (
          <RenameCard
            id="account-name"
            label="Account name"
            value={team.name}
            onSave={async (name) => {
              await api.updateTeam(team.id, { name });
              refreshAccountTeam();
              await router.invalidate();
            }}
            errorFallback="Could not save the account name."
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            You are not on a team, so there is no account to name.
          </p>
        )}
      </SettingsColumn>
    </Page>
  );
}
