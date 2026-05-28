import { hasZitadelSecret } from "../../detect/state";
import type { CliIO, GlobalOptions } from "../../io/output";
import { ok, skipped } from "../../io/output";
import { isObject } from "../json";
import { readZitadelConfig, readZitadelSecret } from "./shared";

/**
 * Reports the local project state by reading `zitadel.json` and its secret.
 * A present config with a missing secret is treated as an "orphaned" install
 * (emitted as skipped with recovery commands) rather than an error, so status
 * stays informational and safe to run on partial or broken setups.
 */
export async function runStatus(io: CliIO, opts: GlobalOptions): Promise<void> {
  const config = await readZitadelConfig(opts.cwd);

  if (!(await hasZitadelSecret(opts.cwd))) {
    skipped(
      io,
      "orphaned-config",
      opts,
      {
        project_id: typeof config.project === "string" ? config.project : undefined,
        lifecycle: "orphaned-config",
        message: "zitadel.json exists but .zitadel/secret is missing.",
      },
      ["zitadel setup --force", "zitadel doctor --fix"],
    );
    return;
  }

  const secret = await readZitadelSecret(opts.cwd);
  ok(
    io,
    {
      title: "Zitadel project detected.",
      project: {
        project_id: String(config.project ?? secret.project_id ?? ""),
        issuer:
          isObject(config.environments) && isObject(config.environments.development)
            ? config.environments.development.issuer
            : undefined,
      },
      server: opts.source,
      next_actions: ["Run `zitadel doctor`.", "Run `zitadel apply` after config changes."],
      next_commands: ["zitadel doctor", "zitadel apply"],
    },
    opts,
  );
}
