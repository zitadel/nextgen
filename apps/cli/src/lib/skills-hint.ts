import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import consola from "consola";
import * as rosie from "rosie-skills";

import { command, wrapForBox } from "./box";
import { telemetryConfigDir } from "./telemetry/identity";

export type SkillsHintInput = {
  env: NodeJS.ProcessEnv;
  /** False for `--json`, `--non-interactive`, or a non-TTY stream. */
  interactive: boolean;
};

const SHOWN_FILE = "skills-hint.json";
const INSTALL_COMMAND = "npx skills add zitadel/nextgen --full-depth";

/**
 * Show, once and before the command's own output, a banner telling a developer
 * who has AI coding agents installed how to give them the Zitadel skills. The
 * CLI never installs anything itself: it names the command and the developer
 * runs it. Modelled on Wrangler's skills suggestion, minus the prompt.
 *
 * Silent in CI, in non-interactive runs, when no agent is detected, once it has
 * been shown, and when `NO_SKILLS_PROMPT` is set. Fail-open: nothing here may
 * fail the command the user actually ran.
 */
export async function showSkillsHint({ env, interactive }: SkillsHintInput): Promise<void> {
  try {
    if (!interactive || isCI(env) || isOptedOut(env)) {
      return;
    }
    const shownPath = join(telemetryConfigDir(env), SHOWN_FILE);
    if (existsSync(shownPath)) {
      return;
    }
    const names = (await rosie.agents())
      .filter((agent) => agent.detected && agent.installPath !== null)
      .map((agent) => agent.display);
    if (names.length === 0) {
      return;
    }
    // Written before printing, so an interrupted run does not show it twice.
    mkdirSync(dirname(shownPath), { recursive: true });
    writeFileSync(shownPath, `${JSON.stringify({ date: new Date().toISOString() })}\n`);

    consola.box({
      title: "Zitadel skills",
      message: wrapForBox(
        [
          `Zitadel detected AI coding agents on this machine: ${names.join(", ")}.`,
          "They work best with the Zitadel skills installed. To add them, run:",
          "",
          `  ${command(INSTALL_COMMAND)}`,
          "",
          "This banner shows once. Set NO_SKILLS_PROMPT=1 to never see it.",
        ].join("\n"),
      ),
      style: { padding: 1, borderStyle: "rounded", borderColor: "cyan" },
    });
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
