import {
  acmeDeployCommand,
  acmeSsoCommand,
  deploymentHistoryCommand,
  setupCommand,
} from "../commands";

// What the CLI printed, for the front page's windows (page.tsx) and the
// phase pages' change history: recorded on 28 November 2026 with this
// repository's @zitadel/cli 0.9.0 against a local server it started (`start`),
// in a new Next.js app's folder, on a terminal 100 columns wide without
// colour, in this order: setup (with --skip-install), the company asked at
// sign-up committed and deployed, Acme's OpenID Connect provider connected
// with a mock issuer and client, committed and deployed, then that deploy
// rolled back, and the deployments listed. Lines are cut from the output,
// never reworded; the IDs, hashes and times are that run's. Re-record rather
// than edit when the CLI's output changes (AGENTS.md).

/** A command and lines of what it printed. */
export type Run = { command: string; output: readonly string[] };

// The two lines of setup's progress that say what it did.
export const setupRun: Run = {
  command: setupCommand,
  output: ["✔  Patched 34 files (1 unchanged)", "✔  Deployed sha256:60c2a0b1dfb2 to 1 origin"],
};

// The first line of the provider's connection, and the deploy's last word.
export const acmeSsoRuns: readonly Run[] = [
  {
    command: acmeSsoCommand,
    output: ["Acme SSO sign-in is configured locally", "Wrote .zitadel/idps/acme-sso.json"],
  },
  {
    command: acmeDeployCommand,
    output: ["Release sha256:8f6b3ac19736 is now live on http://localhost:3000."],
  },
];

// The deployments since setup, newest first, each with why: the table as the
// terminal drew it, and its closing line.
export const historyRun: Run = {
  command: deploymentHistoryCommand,
  output: [
    "  reason     message                                  deployed_at",
    " ──────────────────────────────────────────────────────────────────────────",
    "  rollback   Wait for Acme to register the callback   2026-11-28T02:17:28Z",
    "  deploy     Connect Acme's single sign-on            2026-11-28T02:16:57Z",
    "  deploy     Ask for the company at sign-up           2026-11-28T02:15:52Z",
    "  deploy     Initial deployment from setup            2026-11-28T02:13:14Z",
    "",
    "Found 4 deployments · project proj_01M8FYV5HWDZXNAFGHQYGAQC8V on localhost:8080",
  ],
};
