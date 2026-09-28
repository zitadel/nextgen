import { createFileRoute } from "@tanstack/react-router";

import { RESOURCE_PAGE, RESOURCE_TABLE_WRAP } from "@/components/resource-list";

/**
 * Account settings — where the sidebar's account dropdown lands, and the route
 * that puts the shell into its Settings view.
 *
 * It carries no `staticData.nav` entry on purpose: the design reaches settings
 * from the account dropdown, not from the primary sidebar list, so the route is
 * addressable without being advertised as a nav row (Console ADR 0001).
 *
 * There is no settings screen to land on yet. Admins moved to the project's
 * own page (#1238: a grant is project-level data, not an account setting), and
 * `ACCOUNT / Profile` needs a call that updates a user (#693) and is not built.
 * Until Profile lands this renders the view's empty state rather than
 * redirecting somewhere unrelated; redirect to Profile once it exists.
 */
export const Route = createFileRoute("/_authed/settings/")({
  component: SettingsEmpty,
});

/** Same fixed column the settings screens use; named as a token in #1064. */
const SETTINGS_COLUMN = "mx-auto w-full max-w-[704px]";

function SettingsEmpty() {
  return (
    <div className={`${RESOURCE_PAGE} pt-11`}>
      <div className={SETTINGS_COLUMN}>
        <h1 className="text-foreground font-serif text-2xl leading-6 tracking-tight">Settings</h1>
        <div
          className={`${RESOURCE_TABLE_WRAP} text-muted-foreground mt-6 py-24 text-center text-xs`}
        >
          No settings yet.
        </div>
      </div>
    </div>
  );
}
