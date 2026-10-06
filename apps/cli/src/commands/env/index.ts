import { BaseCommand, CommandGroups, type JsonEnvelope } from "../../lib/oclif";
import { resolveTarget, TARGET_KEYS, type Target } from "../../lib/target";

/** The labels `zitadel env` prints a resolved value under. */
const LABELS: Record<(typeof TARGET_KEYS)[number], string> = {
  ZITADEL_URL: "server",
  ZITADEL_PROJECT_ID: "project",
  ZITADEL_PROJECT_SECRET: "secret",
  ZITADEL_PREVIEW_TOKEN: "preview token",
  ZITADEL_PUBLISHABLE_KEY: "publishable key",
};

/** `zitadel env` — what resolved for this invocation and where each value came from. */
export default class Env extends BaseCommand {
  static override description = "Show which server and project this directory resolves to, and from where.";
  static override group = CommandGroups.project;
  static override groupOrder = 5;
  static override examples = [
    "<%= config.bin %> env",
    "<%= config.bin %> env --env production",
    "<%= config.bin %> env --env-file ./infra/acme-staging.env",
  ];

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Env);
    await this.toMeta(flags);
    const { cwd, env, serverFlag, envName, envFile } = this.meta;
    const target = await resolveTarget({ cwd, env, serverFlag, envName, envFile });
    return this.emit({ status: "ok", data: targetData(target), pretty: renderTarget(target) });
  }
}

export function targetData(target: Target): Record<string, unknown> {
  return {
    environment: target.environment,
    server: target.values.ZITADEL_URL,
    project_id: target.values.ZITADEL_PROJECT_ID,
    credentials: {
      project_secret: target.values.ZITADEL_PROJECT_SECRET?.source,
      preview_token: target.values.ZITADEL_PREVIEW_TOKEN?.source,
      publishable_key: target.values.ZITADEL_PUBLISHABLE_KEY?.source,
    },
    consulted: target.consulted,
  };
}

/** Secrets are shown by their source only; a value never reaches the screen. */
export function renderTarget(target: Target): string {
  const lines = [`environment  ${target.environment.value.padEnd(20)} ${target.environment.source}`];
  for (const key of TARGET_KEYS) {
    const resolved = target.values[key];
    if (!resolved) {
      continue;
    }
    const secret = key === "ZITADEL_PROJECT_SECRET" || key === "ZITADEL_PREVIEW_TOKEN";
    const shown = secret ? `${resolved.value.slice(0, 8)}…` : resolved.value;
    lines.push(`${LABELS[key].padEnd(12)} ${shown.padEnd(20)} ${resolved.source}`);
  }
  lines.push("", "consulted, in order:");
  for (const entry of target.consulted) {
    const supplied =
      typeof entry.supplied === "string"
        ? `(${entry.supplied})`
        : entry.supplied.length === 0
          ? "(no relevant keys)"
          : entry.supplied.map((key) => LABELS[key]).join(", ");
    lines.push(`  ${entry.source.padEnd(28)} ${supplied}`);
  }
  return lines.join("\n");
}
