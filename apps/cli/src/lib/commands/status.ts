import { hasZitadelSecret } from "../../detect";
import type { CommandResult, GlobalOptions } from "../oclif";
import { readDevelopmentIssuer, readZitadelConfig, readZitadelSecret } from "./shared";

/**
 * Reports the local project state by reading `zitadel.json` and its secret.
 * A present config with a missing secret is treated as an "orphaned" install
 * (returned as skipped with recovery commands) rather than an error, so status
 * stays informational and safe to run on partial or broken setups.
 */
export async function runStatus(opts: GlobalOptions): Promise<CommandResult> {
  const config = await readZitadelConfig(opts.cwd);

  if (!(await hasZitadelSecret(opts.cwd))) {
    return {
      status: "skipped",
      reason: "orphaned-config",
      data: {
        project_id: typeof config.project === "string" ? config.project : undefined,
        lifecycle: "orphaned-config",
        message: "zitadel.json exists but .zitadel/secret is missing.",
      },
      nextCommands: ["zitadel setup --force", "zitadel doctor --fix"],
    };
  }

  const secret = await readZitadelSecret(opts.cwd);
  return {
    status: "ok",
    data: {
      title: "Zitadel project detected.",
      project: {
        project_id: String(config.project ?? secret.project_id ?? ""),
        issuer: readDevelopmentIssuer(config),
      },
      server: opts.source,
      next_actions: ["Run `zitadel doctor`.", "Run `zitadel apply` after config changes."],
      next_commands: ["zitadel doctor", "zitadel apply"],
    },
  };
}
