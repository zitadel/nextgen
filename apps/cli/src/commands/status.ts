import type { CliIO, GlobalOptions } from "../io/output";
import { ok, skipped } from "../io/output";
import { hasZitadelSecret } from "../detect/state";
import { readZitadelConfig, readZitadelSecret } from "./shared";

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
        lifecycle: secret.claimed_at && secret.team_id ? "claimed" : "pre-claim",
      },
      server: opts.source,
      next_actions: ["Run `zitadel doctor`.", "Run `zitadel apply` after config changes."],
      next_commands: ["zitadel doctor", "zitadel apply"],
    },
    opts,
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
