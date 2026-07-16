import { cancel, isCancel, select, spinner } from "@clack/prompts";
import { Flags } from "@oclif/core";
import { consola } from "consola";

import { createZitadelClient, type ZitadelClient } from "@zitadel/api/client";
import type { ListSchemas200Item } from "@zitadel/api/generated/model";

import { BaseCommand, type JsonEnvelope } from "../../lib/oclif";
import { environmentSchema } from "../../lib/environment";
import { readZitadelSecret } from "../../lib/project";

/**
 * The `schemas list` topic command — inspect the revision history of a
 * user-schema, filtered by `objectType`.
 *
 * Non-interactive: prints one row per revision (newest first) as a JSON payload
 * or a plain-text table. Interactive: renders a `@clack/prompts` `select` menu
 * of the same rows; on selection, fetches the full schema body via
 * `getSchemaById` and pretty-prints it to stdout.
 */
export default class SchemasList extends BaseCommand {
  static override description = "List revisions of a user-schema by objectType.";
  static override flags = {
    "object-type": Flags.string({
      char: "t",
      required: true,
      description: "Filter revisions by objectType (e.g. human-user).",
    }),
    environment: Flags.string({
      char: "e",
      description: "Target environment (default: development).",
      options: [...environmentSchema.options],
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(SchemasList);
    await this.toMeta(flags);
    const { cwd, source, nonInteractive } = this.meta;

    const secret = await readZitadelSecret(cwd);
    consola.info(`Project   ${secret.project_id}`);
    consola.info(`Server    ${source}`);
    const client = createZitadelClient({
      baseUrl: source,
      token: secret.project_secret,
    });

    const objectType = flags["object-type"];
    const revisions = await client.listSchemas({
      project_id: secret.project_id,
      object_type: objectType,
    });

    // Envelope rows are snake_case like every other command's data; the
    // orval model's `createdAt` is not spread verbatim.
    const revisionRows = revisions.map((r) => ({ id: r.id, created_at: r.createdAt }));

    if (revisions.length === 0) {
      const message = `No revisions found for objectType "${objectType}".`;
      consola.warn(message);
      return this.emit({
        status: "ok",
        data: { object_type: objectType, revisions: [], count: 0 },
        pretty: message,
      });
    }

    // Server orders newest-first; the interactive picker inherits that order.
    if (nonInteractive) {
      return this.emit({
        status: "ok",
        data: {
          object_type: objectType,
          revisions: revisionRows,
          count: revisions.length,
        },
        pretty: renderTable(objectType, revisions),
      });
    }

    const picked = await select({
      message: `Revisions of objectType "${objectType}" (newest first)`,
      options: revisions.map((r, idx) => ({
        value: r.id,
        label: `${r.createdAt}   ${r.id}${idx === 0 ? "   (latest)" : ""}`,
      })),
    });
    if (isCancel(picked)) {
      cancel("No revision selected.");
      return this.emit({
        status: "ok",
        data: { object_type: objectType, revisions: revisionRows, count: revisions.length },
        pretty: "",
      });
    }

    const s = spinner();
    s.start(`Loading ${String(picked)}…`);
    const body = await fetchSchemaRevision(client, String(picked), secret.project_id);
    s.stop(`Loaded ${String(picked)}`);

    const pretty = JSON.stringify(body, null, 2);

    return this.emit({
      status: "ok",
      data: {
        object_type: objectType,
        revisions: revisionRows,
        selected: { id: picked, body },
        count: revisions.length,
      },
      pretty,
    });
  }
}

/**
 * Fetch one schema revision body. The id is URL-encoded before it lands in
 * the path: server-allocated ids are opaque today (`sch_…`), but ids can be
 * full URLs when a schema carried an `$id` (the server-seeded defaults do),
 * and an unencoded URL would break the `/schemas/:id` path. Mirrors the
 * encoding the sync engine's schema syncer applies.
 */
export async function fetchSchemaRevision(
  client: ZitadelClient,
  id: string,
  projectId: string,
): Promise<unknown> {
  return client.getSchemaById(encodeURIComponent(id), { project_id: projectId });
}

function renderTable(objectType: string, revisions: ReadonlyArray<ListSchemas200Item>): string {
  const header = `Revisions of objectType "${objectType}" (${revisions.length}, newest first)`;
  const idCol = Math.max("id".length, ...revisions.map((r) => r.id.length));
  const createdCol = Math.max("createdAt".length, ...revisions.map((r) => r.createdAt.length));
  const rows = revisions.map(
    (r) => `${r.createdAt.padEnd(createdCol)}  ${r.id.padEnd(idCol)}`,
  );
  return [
    header,
    `${"createdAt".padEnd(createdCol)}  ${"id".padEnd(idCol)}`,
    `${"-".repeat(createdCol)}  ${"-".repeat(idCol)}`,
    ...rows,
  ].join("\n");
}
