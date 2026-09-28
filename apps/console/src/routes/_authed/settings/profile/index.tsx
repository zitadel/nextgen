import { createFileRoute, useRouteContext } from "@tanstack/react-router";
import { CircleUserRound } from "lucide-react";
import { useId } from "react";

import { SettingsPage } from "@/components/settings-page";
import { Input } from "@/components/ui/input";

/**
 * Settings › Profile — the Figma `Settings Page / Profile` frames (desktop
 * 1556:87256, mobile 1718:21347, section 1568:97804).
 *
 * Read-only by design: updating a user needs a `PATCH /users/{user_id}` that
 * does not exist (#693), and the frame annotates the email "Email can't be
 * changed" anyway. The value is the signed-in identity from `GET /sessions/me`.
 *
 * Geometry: the shared `SettingsPage` frame; one card whose single row splits
 * label and field 50/50 with 12px between (stacked on mobile).
 */
export const Route = createFileRoute("/_authed/settings/profile/")({
  staticData: {
    nav: { label: "Profile", view: "settings", group: "ACCOUNT", order: 1, icon: CircleUserRound },
  },
  component: ProfileScreen,
});

function ProfileScreen() {
  const { session } = useRouteContext({ from: "/_authed" });
  const emailId = useId();

  return (
    <SettingsPage title="Profile">
      {/* An inset ring rather than a border: Figma draws this stroke inside the
          76px card, and a CSS border would add 2px to it. */}
      <section className="overflow-hidden rounded-md bg-card shadow-xs ring-1 ring-foreground/10 ring-inset">
        <div className="flex flex-col gap-4 px-6 py-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label
              htmlFor={emailId}
              className="min-w-0 flex-1 font-serif text-sm leading-5 whitespace-nowrap text-foreground"
            >
              Email address
            </label>
            <div className="min-w-0 flex-1">
              <Input
                id={emailId}
                type="email"
                value={session.user?.identifier ?? ""}
                disabled
                readOnly
                aria-describedby={`${emailId}-hint`}
                className="h-9 rounded-md px-2.5 py-1 text-sm"
              />
              <span id={`${emailId}-hint`} className="sr-only">
                Email can&apos;t be changed.
              </span>
            </div>
          </div>
        </div>
      </section>
    </SettingsPage>
  );
}
