import { BaseCommand, type JsonEnvelope } from "../lib/oclif";
import { describeRegistry } from "../lib/oclif/crud";
import { RESOURCES } from "./resources";

/**
 * `zitadel resources` — what the resource surface exposes, in one call.
 *
 * An agent's first questions are "which resources exist, what can I do to
 * each, what can I filter on, and what does a body need". Answering those from
 * `--help` means one invocation per topic and parsing prose; this answers all
 * of them from the registry at once, and `--json` makes it machine-readable.
 * The command talks to no server: it describes the CLI, not the project.
 */
export default class ResourcesList extends BaseCommand {
  static override id = "resources";
  static override description = "List the resources this CLI manages and what can be done to each.";
  static override examples = [
    "<%= config.bin %> resources",
    "<%= config.bin %> resources --json",
    '<%= config.bin %> resources --json | jq -r \'.data.resources[] | "\\(.topic): \\(.verbs | join(", "))"\'',
  ];

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(ResourcesList);
    // No server call, so no server resolution: the answer is the same offline.
    await this.toMeta(flags, { resolveServer: false });
    const resources = describeRegistry(RESOURCES);

    const rows = resources.map((resource) => ({
      topic: String(resource.topic),
      verbs: (resource.verbs as string[]).join(", "),
      filters: [
        ...((resource.filter_fields as string[] | undefined) ?? []),
        ...((resource.params as string[] | undefined) ?? []),
      ].join(", "),
    }));
    const width = (key: keyof (typeof rows)[number]) =>
      Math.max(key.length, ...rows.map((row) => row[key].length));
    const widths = { topic: width("topic"), verbs: width("verbs"), filters: width("filters") };
    const line = (topic: string, verbs: string, filters: string) =>
      `${topic.padEnd(widths.topic)}  ${verbs.padEnd(widths.verbs)}  ${filters}`.trimEnd();

    return this.emit({
      status: "ok",
      data: { resources, count: resources.length },
      pretty: [
        line("resource", "verbs", "filter on"),
        line("-".repeat(widths.topic), "-".repeat(widths.verbs), "-".repeat(widths.filters)),
        ...rows.map((row) => line(row.topic, row.verbs, row.filters)),
        "",
        `${resources.length} resources. Run \`${this.config.bin} <resource> <verb> --help\` for a command's flags.`,
      ].join("\n"),
    });
  }
}
