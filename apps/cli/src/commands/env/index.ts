import { ENVIRONMENT_KEYS, type EnvironmentKey } from "@/lib/environment";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { CommandGroups, EnvironmentCommand, type JsonEnvelope } from "@/lib/oclif";
import { Tabulatable } from "@/lib/oclif/tabulatable";
import { painted } from "@/lib/oclif/rendering";

/** The values that grant access, never printed — only named and masked. */
const SECRET_KEYS: ReadonlySet<EnvironmentKey> = new Set([
  "ZITADEL_PROJECT_SECRET",
  "ZITADEL_PREVIEW_TOKEN",
]);

/**
 * A fixed, length-independent mask for a secret's value. A prefix of the real
 * value would leak a short secret whole and narrow the search space of a long
 * one, so the output never derives from the secret at all.
 */
const REDACTED = "••••••••";

/**
 * `zitadel env` — what this directory resolves to for the environment in use,
 * and which source supplied each value. It never prints a secret in full, so
 * the output is safe to paste into a bug report.
 */
export default class Env extends Tabulatable(EnvironmentCommand) {
  static override description =
    "Show which server and project resolve, and where each value came from.";

  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> env",
    "<%= config.bin %> env --env production",
    "<%= config.bin %> env --env-file ./infra/acme-staging.env",
  ];

  protected async execute(): Promise<JsonEnvelope> {
    const { name, values, consulted } = this.environment;

    const resolved = ENVIRONMENT_KEYS.flatMap((key) => {
      const entry = values[key];
      if (!entry) {
        return [];
      }
      const shown = SECRET_KEYS.has(key) ? REDACTED : entry.value;
      return [{ variable: key, value: shown, source: entry.source }];
    });
    const lookups = consulted.map(({ source, present, supplied }) => ({
      source,
      present,
      supplied: supplied.join(", "),
    }));

    // Every command that resolves a project ends on where it ran. This one
    // never opens a connection — reporting what resolves is its whole job —
    // so it states the same place from the values it just read, rather than
    // being the one command whose answer has no footer under it.
    this.ui.ranAgainst(
      values.ZITADEL_PROJECT_ID?.value,
      values.ZITADEL_URL?.value.replace(/^https?:\/\//, ""),
    );

    const variables = await this.tabulate(["variable", "value", "source"], resolved);
    const sources = await this.tabulate(["source", "present", "supplied"], lookups);

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
      // Painted, because the two tables below are the CLI's own; the heading
      // names a value read from a file, so it is spelled out here. A script is
      // given the tables under that heading, not under the sentence a person's
      // ending closes on.
      pretty: painted(
        [
          // One space, not two: two made the headline look like a row of a
          // table, so it was read as part of the answer and the run ended
          // with no footer at all.
          escapeControlCharacters(`Environment ${name.value} (from ${name.source})`),
          "",
          variables,
          "",
          "Consulted, in order:",
          sources,
        ].join("\n"),
      ),
      summary: {
        title: escapeControlCharacters(`Using the ${name.value} environment (from ${name.source})`),
        sections: [],
        lines: [...variables.split("\n"), "", "Consulted, in order:", ...sources.split("\n")],
      },
    });
  }
}
