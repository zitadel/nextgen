import { publicCliCommand } from "./public-cli";

/**
 * Journey-staged guidance copy shared by `setup` and `status`.
 *
 * The staging exists because of alpha tester feedback (Elina, alpha.15):
 * printing customize/publish steps before the user has logged in once reads
 * as noise, but dropping them entirely recreates the round-1 dead end where
 * nothing pointed to the next step. So the guidance tracks journey position —
 * verify first, customize/publish once login demonstrably works — and both
 * commands quote the same copy so the story doesn't fork.
 */

/**
 * The verify mission: prove the scaffolded auth round-trips before touching
 * config. `openUrl` prefixes the browser destination for callers that have
 * not already narrated it (setup's box has a separate "Start your project"
 * line; status has only the issuer).
 */
export function verifyLoginAction(openUrl?: string): string {
  const open = openUrl ? `open ${openUrl}, ` : "";
  return (
    `Verify auth in the browser: ${open}register a user, log out, ` +
    "log in again with the same user, and confirm /profile shows Signed in."
  );
}

/** The customize/publish pair, in Elina's tested wording. */
export function customizeAndPublishActions(cliVersion: string): string[] {
  return [
    "Customize what you ask for and how people sign in: edit .zitadel/schemas/ to change " +
      "the information you collect, and .zitadel/flows/ to change the sign-up/sign-in " +
      "experience. Each folder has a README with examples.",
    `See your changes before they go live: ${publicCliCommand("plan", cliVersion)} to preview, ` +
      `then ${publicCliCommand("apply", cliVersion)} to publish.`,
  ];
}
