import { ENVIRONMENT_KEYS, type EnvironmentKey } from "../../lib/environment";
import { CommandGroups, EnvironmentCommand, type JsonEnvelope } from "../../lib/oclif";
import { renderTable } from "../../lib/oclif/crud/table";

/** The values that grant access, shown by their first characters only. */
const SECRET_KEYS: ReadonlySet<EnvironmentKey> = new Set([
  "ZITADEL_PROJECT_SECRET",
  "ZITADEL_PREVIEW_TOKEN",
]);

/**
 * `zitadel env` — what this directory resolves to for the environment in use,
 * and which source supplied each value. It never prints a secret in full, so
 * the output is safe to paste into a bug report.
 */
export default class Env extends EnvironmentCommand {
  static override description =
    "Show which server and project resolve, and where each value came from.";
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
    const { name, values, consulted } = this.environment;

    const resolved = ENVIRONMENT_KEYS.flatMap((key) => {
      const entry = values[key];
      if (!entry) {
        return [];
      }
      const shown = SECRET_KEYS.has(key) ? `${entry.value.slice(0, 8)}…` : entry.value;
      return [{ variable: key, value: shown, source: entry.source }];
    });
    const lookups = consulted.map(({ source, present, supplied }) => ({
      source,
      present,
      supplied: supplied.join(", "),
    }));

    return this.emit({
      status: "ok",
      data: {
        environment: { name: name.value, source: name.source },
        values: resolved,
        consulted: consulted.map(({ source, present, supplied }) => ({
          source,
          present,
          supplied: [...supplied],
        })),
      },
      pretty: [
        `Environment  ${name.value} (from ${name.source})`,
        "",
        renderTable(["variable", "value", "source"], resolved),
        "",
        "Consulted, in order:",
        renderTable(["source", "present", "supplied"], lookups),
      ].join("\n"),
    });
  }
}
