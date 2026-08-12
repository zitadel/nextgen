import { createFileRoute } from "@tanstack/react-router";
import { Settings } from "lucide-react";

import { ComingSoon } from "../../../components/coming-soon";

/**
 * Account settings — where the sidebar's account dropdown lands, and the route
 * that puts the shell into its Settings view.
 *
 * It carries no `staticData.nav` entry on purpose: the design reaches settings
 * from the account dropdown, not from the primary sidebar list, so the route is
 * addressable without being advertised as a nav row (Console ADR 0001).
 *
 * The screen is a stub, because nothing the designed Settings view holds is
 * buildable yet:
 *
 *   - `PERSONAL / Profile` needs a call that updates a user. There is no
 *     `PATCH /users/{user_id}`, and neither the SDK nor the console exposes an
 *     update call of any kind (#693).
 *   - `WORKSPACE / Teams` and `Members` need a team reference on the user read
 *     responses. `POST /teams/query` lists teams, but nothing on a user says
 *     which ones they belong to (#735).
 *
 * Those rows arrive with the screens behind them. Until then the Settings view
 * is the header and the back row, and this page says why.
 */
export const Route = createFileRoute("/_authed/settings/")({
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <ComingSoon
      title="Settings"
      description="Account settings need a call that updates a user, and a team reference on the user read responses. Neither exists yet."
      icon={Settings}
    />
  );
}
