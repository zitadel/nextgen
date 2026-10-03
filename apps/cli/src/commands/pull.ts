import { mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { Args } from "@oclif/core";
import { consola } from "consola";

import { createZitadelClient, escapeControlCharacters } from "../lib/api-client";
import { ZitadelError } from "../lib/errors";
import { BaseCommand, CommandGroups, type JsonEnvelope, nonBlankArg } from "../lib/oclif";
import { readZitadelSecret } from "../lib/project";
import { publicCliCommand } from "../lib/public-cli";
import { makeSyncers, type ResourceSyncer, updateState, writeBackResource } from "../lib/sync";

/** A syncer that can serve a pull: it knows how to find and read a revision. */
type PullableSyncer = ResourceSyncer & {
  newestRevision: NonNullable<ResourceSyncer["newestRevision"]>;
  fetch: NonNullable<ResourceSyncer["fetch"]>;
};

/** A handle is a single file-name segment, so it can never escape the kind's directory. */
const HANDLE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Longest handle that keeps `<handle>.json` within the common 255-byte filename limit. */
const HANDLE_MAX = 250;

/**
 * The relative path of the local file that already tracks `handle` — found by
 * reading each file in the kind's directory and asking the syncer for its
 * handle — or undefined when none does (a fresh checkout, or a new resource).
 */
async function existingFileForHandle(
  cwd: string,
  syncer: PullableSyncer,
  handle: string,
): Promise<string | undefined> {
  let entries: string[];
  try {
    entries = await readdir(join(cwd, syncer.directory));
  } catch (error) {
    // No directory yet (a fresh checkout) means no file tracks the handle; any
    // other error is real and must not be read as "no match".
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".json")) {
      continue;
    }
    // A `.json` that cannot be read or parsed is propagated, not skipped:
    // skipping the file that tracks the handle would write a duplicate and
    // leave the stale file behind.
    const body = JSON.parse(await readFile(join(cwd, syncer.directory, entry), "utf8")) as object;
    if (syncer.handleOf?.(body) === handle) {
      return `${syncer.directory}/${entry}`;
    }
  }
  return undefined;
}

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
      description: "Resource kind to pull; the error hint lists the kinds pull supports.",
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

    if (!HANDLE.test(handle) || handle.length > HANDLE_MAX) {
      throw new ZitadelError("E_VALIDATION", `Invalid ${kind} handle "${handle}".`, {
        hint: `A handle is a single name of at most ${HANDLE_MAX} characters: letters or digits, then letters, digits, '.', '_' or '-'.`,
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
    // A kind is pullable when its syncer can find and read a revision; the set
    // follows the syncers, so a new revisioned kind needs no change here.
    const pullable = syncers.filter(
      (candidate): candidate is PullableSyncer =>
        candidate.newestRevision !== undefined && candidate.fetch !== undefined,
    );
    const syncer = pullable.find((candidate) => candidate.kind === kind);
    if (syncer === undefined) {
      throw new ZitadelError("E_VALIDATION", `Cannot pull a ${kind}.`, {
        hint: `Pullable kinds: ${pullable.map((candidate) => candidate.kind).join(", ")}.`,
      });
    }

    consola.start(`Fetching ${kind} ${handle}`);
    const id = await syncer.newestRevision(handle);
    if (id === null) {
      throw new ZitadelError("E_NOT_FOUND", `No ${kind} named "${handle}" on the server.`, {
        hint: "List the project's resources to see which handles exist.",
      });
    }

    const fetched = await syncer.fetch(id);
    const { body, warnings } = syncer.localise
      ? await syncer.localise(fetched, syncers)
      : { body: fetched, warnings: [] };
    // Update the resource's existing local file when one already tracks this
    // handle under a different name (setup writes default-human-user.json for
    // the human-user schema); only fall back to <handle>.json when none does,
    // so a pull never leaves a second file for the same resource.
    const relPath =
      (await existingFileForHandle(cwd, syncer, handle)) ?? `${syncer.directory}/${handle}.json`;
    // The verbatim client leaves server bytes unsanitized, so every value that
    // reaches the terminal is escaped here; the raw values still go to the
    // file, the envelope and state.
    const safeId = escapeControlCharacters(id);

    for (const warning of warnings) {
      consola.warn(escapeControlCharacters(warning));
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
        pretty: `Fetched ${safeId}.\nWould write ${relPath} (dry run).`,
      });
    }

    await mkdir(dirname(join(cwd, relPath)), { recursive: true });
    // `writeBackResource` normalizes, carries an existing file's local-only
    // `$schema` editor pointer over, and returns the hash to record.
    const { hash } = await writeBackResource(cwd, relPath, syncer, body);

    // Record the revision this file now represents, so the next plan sees it
    // in sync rather than as an upload. A dir that never ran setup has no state
    // file — plan would fail there, so that case is skipped and plan is not
    // suggested below; an unreadable or malformed state file is a real failure.
    let recorded = false;
    try {
      await updateState(cwd, relPath, { id, hash });
      recorded = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    consola.success(`Wrote ${relPath}`);

    return this.emit({
      status: "ok",
      warnings,
      // Only suggest plan when the pull was recorded: without a state file plan
      // cannot run, so advertising it would hand the caller a failing command.
      data: {
        kind,
        handle,
        id,
        path: relPath,
        next_commands: recorded ? [publicCliCommand("plan", cliVersion)] : [],
      },
      pretty: `Fetched ${safeId}.\nWrote ${relPath}.`,
    });
  }
}
