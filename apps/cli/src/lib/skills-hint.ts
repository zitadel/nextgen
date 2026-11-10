import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { log } from "@/lib/log";
import * as rosie from "rosie-skills";

import type { BoxAction } from "./box";
import { command } from "./style";
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

/** Where the once-per-machine marker lives, or nowhere when the machine has no config directory. */
function shownFile(env: NodeJS.ProcessEnv): string | undefined {
  const configDir = telemetryConfigDir(env);
  return configDir === undefined ? undefined : join(configDir, SHOWN_FILE);
}

/**
 * The marker's path when this machine is still to be offered the skills:
 * someone is watching, nothing opts out, an agent is installed, and the offer
 * has not been made before. Reads the filesystem. Both ways of offering the
 * skills decide through this, so the conditions cannot drift apart.
 */
async function pendingOffer({ env, interactive }: SkillsHintInput): Promise<string | undefined> {
  if (!interactive || isCI(env) || isOptedOut(env)) {
    return undefined;
  }
  const shownPath = shownFile(env);
  // No config directory to hold the marker, so the offer could never be
  // recorded as made, and would be made on every run.
  if (shownPath === undefined || existsSync(shownPath)) {
    return undefined;
  }
  // Detected agents only decide whether the offer is relevant; it does not
  // name them.
  const detected = (await rosie.agents()).some(
    (agent) => agent.detected && agent.installPath !== null,
  );
  return detected ? shownPath : undefined;
}

/**
 * Whether this machine should be offered the skills, resolved while the
 * command runs. {@link claimSkills} is what spends the offer, at the moment the
 * summary is built.
 */
export async function eligibleForSkills(input: SkillsHintInput): Promise<boolean> {
  try {
    return (await pendingOffer(input)) !== undefined;
  } catch {
    // Nothing here may fail the command the person actually ran.
    return false;
  }
}

/**
 * Spends the once-per-machine offer and returns the step to put in the
 * summary, or `undefined` if another run took it first. Written exclusively,
 * so of two concurrent first runs only one shows it.
 */
export function claimSkills(env: NodeJS.ProcessEnv, cliVersion: string): BoxAction | undefined {
  try {
    const shownPath = shownFile(env);
    if (shownPath === undefined) {
      return undefined;
    }
    mkdirSync(dirname(shownPath), { recursive: true });
    writeFileSync(shownPath, `${JSON.stringify({ date: new Date().toISOString() })}\n`, {
      flag: "wx",
    });
    return {
      text: "Using an AI coding agent? Add the Zitadel skills to your project so it can work with the CLI:",
      command: publicCliCommand("skills add", cliVersion),
    };
  } catch {
    return undefined;
  }
}

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
export async function showSkillsHint(input: SkillsHintInput): Promise<void> {
  const { cliVersion } = input;
  try {
    const shownPath = await pendingOffer(input);
    if (shownPath === undefined) {
      return;
    }
    // Created exclusively and before printing: of two concurrent first runs only
    // one gets past `wx`, and an interrupted run never shows the note twice.
    mkdirSync(dirname(shownPath), { recursive: true });
    writeFileSync(shownPath, `${JSON.stringify({ date: new Date().toISOString() })}\n`, {
      flag: "wx",
    });

    try {
      log.plain(
        [
          "",
          "Using an AI coding agent?",
          "Add the Zitadel skills to your project to help your agent work with Zitadel's CLI and authentication integrations:",
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

export function isCI(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.CI) && env.CI !== "0" && env.CI !== "false";
}

function isOptedOut(env: NodeJS.ProcessEnv): boolean {
  const value = env.NO_SKILLS_PROMPT?.trim().toLowerCase();
  return value !== undefined && value !== "" && value !== "0" && value !== "false";
}
