import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { renderBox } from "../term/box";
import { mappingLines } from "../idp";
import { enumeratePlanResources, type PlanResourceChange } from "./plan-renderer";
import type { SyncAction } from "./types";

const MARK: Readonly<Record<PlanResourceChange["action"], string>> = {
  create: "+ create  ",
  update: "~ update  ",
  revision: "~ revision",
  move: "→ move    ",
  delete: "- delete  ",
};

/** The connection file's body, or `undefined` when it cannot be read as a JSON object. */
async function readConnection(
  cwd: string,
  file: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    const body: unknown = JSON.parse(await readFile(join(cwd, file), "utf8"));
    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The plan's changes as a short list, then, for each connection it creates or
 * changes, what the connection maps. The diff above says every field that
 * differs; this says what a person needs to review before applying, and reads
 * the file on disk, which holds variable references and never a secret.
 *
 * Returns `undefined` when the plan changes nothing.
 */
export async function renderPlanSummary(
  cwd: string,
  actions: ReadonlyArray<SyncAction>,
): Promise<string | undefined> {
  const changes = enumeratePlanResources(actions);
  if (changes.length === 0) {
    return undefined;
  }
  const kindWidth = Math.max(...changes.map((change) => change.kind.length));
  const lines = [
    "CHANGES",
    ...changes.map(
      (change) => `${MARK[change.action]}  ${change.kind.padEnd(kindWidth)}  ${change.file}`,
    ),
  ];
  for (const change of changes) {
    if (change.kind !== "idp" || change.action === "delete") {
      continue;
    }
    const connection = await readConnection(cwd, change.file);
    if (connection === undefined) {
      continue;
    }
    const name =
      typeof connection.display_name === "string" && connection.display_name !== ""
        ? connection.display_name
        : (change.file.split("/").pop() ?? change.file).replace(/\.json$/, "");
    lines.push("", `SIGN IN WITH ${name.toUpperCase()}`, ...mappingLines(connection, change.file));
  }
  return renderBox({ title: "Plan summary", message: lines.join("\n") });
}
