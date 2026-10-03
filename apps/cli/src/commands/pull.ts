import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { Args } from "@oclif/core";
import { consola } from "consola";

import { createZitadelClient } from "../lib/api-client";
import { ZitadelError } from "../lib/errors";
import { BaseCommand, CommandGroups, type JsonEnvelope, nonBlankArg } from "../lib/oclif";
import { readZitadelSecret } from "../lib/project";
import { publicCliCommand } from "../lib/public-cli";
import { makeSyncers } from "../lib/sync";

/**
 * Kinds `pull` supports, as the user types them: the revisioned kinds with a
 * list-by-handle endpoint (#541). Others get their pull path on their syncer
 * when they gain revisioning.
 */
const PULLABLE_KINDS = ["schema", "flow"] as const;

/** A handle is a single file-name segment, so it can never escape the kind's directory. */
const HANDLE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * `zitadel pull <kind> <handle>` — fold the newest server-side revision of a
 * resource into local `.zitadel/`, so the next deploy includes it.
 *
 * The use case is adoption: someone edited a resource through the dashboard or
 * MCP, and the developer brings that revision into the git-tracked source of
 * truth. Targeted only — one `(kind, handle)` per run, no bulk mode. All the
 * per-kind work (its list endpoint, and turning the server body into the local
 * file with references by handle) lives on the resource's syncer, so this
 * command only orchestrates.
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
    const { cwd, source, env, dryRun, cliVersion } = this.meta;
    const { kind, handle } = args;

    if (!HANDLE.test(handle)) {
      throw new ZitadelError("E_VALIDATION", `Invalid ${kind} handle "${handle}".`, {
        hint: "A handle is a single name: letters or digits, then letters, digits, '.', '_' or '-'.",
      });
    }

    const secret = await readZitadelSecret(cwd);
    consola.info(`Project   ${secret.project_id}`);
    consola.info(`Server    ${source}`);
    const client = createZitadelClient(
      { baseUrl: source, token: secret.project_secret },
      { verbatim: true },
    );
    const syncers = makeSyncers({ client, projectId: secret.project_id, env, cwd });
    const syncer = syncers.find((candidate) => candidate.kind === kind);
    if (syncer?.newestRevision === undefined || syncer.fetch === undefined) {
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
    const { body, warnings } = syncer.localise
      ? await syncer.localise(fetched, syncers)
      : { body: fetched, warnings: [] };
    const toWrite = syncer.normalizeWrite ? syncer.normalizeWrite(body) : body;
    const relPath = `${syncer.directory}/${handle}.json`;

    for (const warning of warnings) {
      consola.warn(warning);
    }

    if (dryRun) {
      consola.success(`Would write ${relPath}`);
      return this.emit({
        status: "ok",
        warnings,
        // The follow-up is the same pull without --dry-run; the handle is a
        // validated single segment, so it needs no quoting.
        data: {
          kind,
          handle,
          id,
          path: relPath,
          dry_run: true,
          next_commands: [publicCliCommand(`pull ${kind} ${handle}`, cliVersion)],
        },
        pretty: `Fetched ${id}.\nWould write ${relPath} (dry run).`,
      });
    }

    const absPath = join(cwd, relPath);
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, `${JSON.stringify(toWrite, null, 2)}\n`);
    consola.success(`Wrote ${relPath}`);

    return this.emit({
      status: "ok",
      warnings,
      data: { kind, handle, id, path: relPath, next_commands: [publicCliCommand("plan", cliVersion)] },
      pretty: `Fetched ${id}.\nWrote ${relPath}.`,
    });
  }
}
