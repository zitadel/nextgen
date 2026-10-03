import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { Args } from "@oclif/core";
import { consola } from "consola";

import { createZitadelClient } from "../lib/api-client";
import { ZitadelError } from "../lib/errors";
import { BaseCommand, CommandGroups, type JsonEnvelope, nonBlankArg } from "../lib/oclif";
import { readZitadelSecret } from "../lib/project";
import { publicCliCommand } from "../lib/public-cli";
import { makeSyncers, rewriteRefsToHandles } from "../lib/sync";

/**
 * Kinds `pull` supports, as the user types them. The MVP is the two revisioned
 * kinds with a list-by-handle endpoint (#541); others get their pull path when
 * they gain revisioning, which is a new `newestRevision` on their syncer rather
 * than a change here.
 */
const PULLABLE_KINDS = ["schema", "flow"] as const;

/**
 * `zitadel pull <kind> <handle>` — fold the newest server-side revision of a
 * resource into local `.zitadel/`, so the next `deploy` includes it.
 *
 * The use case is adoption: someone edited a resource through the dashboard or
 * MCP, and the developer brings that revision into the git-tracked source of
 * truth. Targeted only — one `(kind, handle)` per run, no bulk mode.
 *
 * On write, concrete revision ids in cross-resource references are rewritten to
 * handles (a flow's `user_schema` `sch_…` → the schema's `objectType`), so the
 * file joins its dependencies by name. The per-kind knowledge — list endpoint,
 * handle field, which fields are references — lives on each resource's syncer,
 * so this command carries no `if (kind === …)` of its own.
 */
export default class Pull extends BaseCommand {
  static override description =
    "Fetch the newest server-side revision of a resource into .zitadel/.";
  static override group = CommandGroups.configuration;
  static override groupOrder = 3;
  static override examples = [
    "<%= config.bin %> pull schema human-user",
    "<%= config.bin %> pull flow login",
  ];
  static override args = {
    kind: Args.string({
      required: true,
      options: [...PULLABLE_KINDS],
      description: "Resource kind to pull.",
    }),
    handle: nonBlankArg({
      required: true,
      description: "Resource handle: a schema's object type, or a flow's name.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { args, flags } = await this.parse(Pull);
    await this.toMeta(flags);
    const { cwd, source, env, dryRun } = this.meta;
    const { kind, handle } = args;

    const secret = await readZitadelSecret(cwd);
    consola.info(`Project   ${secret.project_id}`);
    consola.info(`Server    ${source}`);
    // Verbatim: a pull writes back exactly what the server stores, apart from
    // the reference rewrite below.
    const client = createZitadelClient(
      { baseUrl: source, token: secret.project_secret },
      { verbatim: true },
    );
    const syncers = makeSyncers({ client, projectId: secret.project_id, env, cwd });
    const syncer = syncers.find((candidate) => candidate.kind === kind);
    if (syncer?.newestRevision === undefined || syncer.fetch === undefined) {
      // Unreachable while `options` gates `kind`, but keeps the contract honest
      // if a kind is listed before its syncer can serve a pull.
      throw new ZitadelError("E_VALIDATION", `pull is not supported for ${kind} yet.`, {
        hint: `Pullable kinds: ${PULLABLE_KINDS.join(", ")}.`,
      });
    }

    consola.start(`Fetching ${kind} ${handle}`);
    const id = await syncer.newestRevision(handle);
    if (id === null) {
      throw new ZitadelError("E_NOT_FOUND", `No ${kind} named "${handle}" on the server.`, {
        hint: `Run \`${kind === "flow" ? "flow-definitions" : "schemas"} list\` to see what this project has.`,
      });
    }

    const fetched = await syncer.fetch(id);
    const { body, warnings } = await rewriteRefsToHandles(kind, fetched, syncers);
    const toWrite = syncer.normalizeWrite ? syncer.normalizeWrite(body) : body;
    const relPath = `${syncer.directory}/${handle}.json`;

    for (const warning of warnings) {
      consola.warn(warning);
    }

    // A dry run fetches and rewrites — so its warnings and reported id are
    // real — but leaves the working tree untouched, per the global flag.
    if (dryRun) {
      consola.success(`Would write ${relPath}`);
      return this.emit({
        status: "ok",
        warnings,
        data: {
          kind,
          handle,
          id,
          path: relPath,
          dry_run: true,
          next_commands: [publicCliCommand("pull", this.meta.cliVersion)],
        },
        pretty:
          `Fetched ${id}.\nWould write ${relPath} (dry run).` +
          (warnings.length > 0 ? `\n${warnings.join("\n")}` : ""),
      });
    }

    const absPath = join(cwd, relPath);
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, `${JSON.stringify(toWrite, null, 2)}\n`);
    consola.success(`Wrote ${relPath}`);

    return this.emit({
      status: "ok",
      warnings,
      data: {
        kind,
        handle,
        id,
        path: relPath,
        next_commands: [publicCliCommand("plan", this.meta.cliVersion)],
      },
      pretty:
        `Fetched ${id}.\nWrote ${relPath}.` +
        (warnings.length > 0 ? `\n${warnings.join("\n")}` : ""),
    });
  }
}
