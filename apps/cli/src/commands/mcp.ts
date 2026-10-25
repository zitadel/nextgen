import { Flags } from "@oclif/core";
import consola from "consola";

import { ZitadelError } from "../lib/errors";
import { BaseCommand, CommandGroups, type JsonEnvelope } from "../lib/oclif";
import { readZitadelSecret } from "../lib/project";

/**
 * `zitadel mcp` — the Zitadel API as MCP tools, served on stdio to the agent
 * that starts it: one tool per operation `zitadel api` can call, with the
 * same server and project secret. Reads only, unless `--allow-writes`.
 *
 * stdout carries the protocol and nothing else, so everything the CLI would
 * narrate goes to stderr, and `--json` has no envelope to print.
 */
export default class Mcp extends BaseCommand {
  static override group = CommandGroups.resources;
  static override groupOrder = 2;
  static override description =
    "Serve the Zitadel API to an AI agent as MCP tools on stdio, with this project's server and project secret.\n\nAdd it to an MCP client as a stdio server: `claude mcp add zitadel -- npx @zitadel/cli@latest mcp --cwd <app>`. Each tool is one operation, named by its operationId and typed by its schema. The tools only read unless --allow-writes; with --dry-run, a call that writes answers with its request instead of sending it.\n\nExperimental: its tools and flags may change.";
  static override examples = [
    "<%= config.bin %> <%= command.id %>",
    "<%= config.bin %> <%= command.id %> --tag Users --tag Teams",
    "<%= config.bin %> <%= command.id %> --allow-writes",
    "<%= config.bin %> <%= command.id %> --allow-writes --dry-run",
  ];
  static override flags = {
    "allow-writes": Flags.boolean({
      description: "Also offer the operations that create, change or delete.",
    }),
    tag: Flags.string({
      description:
        "Only the operations of this part of the API, as `api ls` lists them. Repeatable.",
      multiple: true,
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Mcp);
    if (this.jsonEnabled()) {
      throw new ZitadelError(
        "E_VALIDATION",
        "MCP is all this command writes to stdout, so --json has no envelope to print",
        { hint: "Leave out --json, and add `zitadel mcp` to your MCP client as a stdio server." },
      );
    }
    const meta = await this.toMeta(flags);
    consola.options.stdout = process.stderr;

    const { toolTags } = await import("../lib/mcp/tools");
    const tags = toolTags();
    const unknown = (flags.tag ?? []).filter(
      (tag) => !tags.some((known) => known.toLowerCase() === tag.toLowerCase()),
    );
    if (unknown.length > 0) {
      throw new ZitadelError("E_VALIDATION", `No part of the API is called ${unknown.join(", ")}`, {
        hint: `The parts: ${tags.join(", ")}.`,
      });
    }
    const secret = await readZitadelSecret(meta.cwd);

    const { createZitadelMcp, serveStdio } = await import("../lib/mcp/server");
    const served = createZitadelMcp({
      version: meta.cliVersion,
      server: meta.source,
      projectId: secret.project_id,
      projectSecret: secret.project_secret,
      writes: flags["allow-writes"],
      tags: flags.tag ?? [],
      dryRun: meta.dryRun,
    });
    if (process.stdin.isTTY) {
      consola.info(
        `Serving ${served.tools.length} tools for ${meta.source} on stdio, for an MCP client to start. Press Ctrl-D to stop.`,
      );
    }
    await serveStdio(served);
    return this.emit({ status: "ok", data: { tools: served.tools.length }, pretty: "" });
  }
}
