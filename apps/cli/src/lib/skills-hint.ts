import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import consola from "consola";
import * as rosie from "rosie-skills";

import { command } from "./box";
import { publicCliCommand } from "./public-cli";
import { telemetryConfigDir } from "./telemetry/identity";

export type SkillsHintInput = {
  env: NodeJS.ProcessEnv;
  /** False for `--json`, `--non-interactive`, or a non-TTY stream. */
  interactive: boolean;
  /** The running CLI's, whose skills the named command adds. */
  cliVersion: string;
};

const SHOWN_FILE = "skills-hint.json";

/**
 * Tell a developer who has AI coding agents installed how to give them the
 * Zitadel skills, once per machine and after the command's own next steps.
 * The note adds nothing itself: it names `zitadel skills add` and the
 * developer runs it. Modelled on Wrangler's skills suggestion, minus the prompt.
 *
 * The marker lives in the user's CLI config directory (`telemetryConfigDir`),
 * not in a project, so a second project on the same machine does not show it
 * again. It is written only once the note is about to be shown, and removed
 * again if showing it fails.
 *
 * Silent in CI, in non-interactive runs, when no agent is detected, once it has
 * been shown, and when `NO_SKILLS_PROMPT` is set. Fail-open: nothing here may
 * fail the command the user actually ran, and losing the race to create the marker
 * (`EEXIST`) just means another run is showing the note.
 */
export async function showSkillsHint({
  env,
  interactive,
  cliVersion,
}: SkillsHintInput): Promise<void> {
  try {
    if (!interactive || isCI(env) || isOptedOut(env)) {
      return;
    }
    const shownPath = join(telemetryConfigDir(env), SHOWN_FILE);
    if (existsSync(shownPath)) {
      return;
    }
    // Detected agents only decide whether the note is relevant; it does not
    // name them.
    const detected = (await rosie.agents()).some(
      (agent) => agent.detected && agent.installPath !== null,
    );
    if (!detected) {
      return;
    }
    // Created exclusively and before printing: of two concurrent first runs only
    // one gets past `wx`, and an interrupted run never shows the note twice.
    mkdirSync(dirname(shownPath), { recursive: true });
    writeFileSync(shownPath, `${JSON.stringify({ date: new Date().toISOString() })}\n`, {
      flag: "wx",
    });

    try {
      consola.log(
        [
          "",
          "Using an AI coding agent?",
          "Add the Zitadel skills to your project to help your agent work with Zitadel’s CLI and authentication integrations:",
          "",
          `  ${command(publicCliCommand("skills add", cliVersion))}`,
          "",
          "Optional. You can continue without installing skills.",
        ].join("\n"),
      );
    } catch (error) {
      // Not shown after all, so it must not count as shown.
      unlinkSync(shownPath);
      throw error;
    }
  } catch {
    // A hint must never break `setup` or the root help.
  }
}

function isCI(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.CI) && env.CI !== "0" && env.CI !== "false";
}

function isOptedOut(env: NodeJS.ProcessEnv): boolean {
  const value = env.NO_SKILLS_PROMPT?.trim().toLowerCase();
  return value !== undefined && value !== "" && value !== "0" && value !== "false";
}
