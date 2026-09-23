import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { idpCatalogEntry, type IdpCatalogEntry } from "@zitadel/config/idp-catalog";

import { ZitadelError } from "../errors";
import { isObject } from "../json";

/**
 * Relative directory (from the project root) where local connection files
 * live, one per provider. Owned here alongside the only reader of it, and
 * re-exported from `lib/idp` so callers and tests share one source of truth
 * for the path, as `FLOWS_DIR` and `SCHEMAS_DIR` do for their domains.
 */
export const IDPS_DIR = ".zitadel/idps";

/**
 * `$schema` pointer a scaffolded connection carries, relative to
 * {@link IDPS_DIR}: the meta-schema `zitadel setup` writes under
 * `.zitadel/meta/`, so an editor validates the file as it is typed.
 */
export const CONNECTION_SCHEMA_REF = "../meta/idp-connection.json";

/** Whether a caught error is the given `errno` code. */
function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

/** A connection file as it sits on disk, with the name needed to report it. */
export type ConnectionFile = {
  /** File name within {@link IDPS_DIR}, e.g. `google.json`. */
  readonly name: string;
  /** Project-relative path, for messages the developer has to act on. */
  readonly path: string;
  readonly body: Record<string, unknown>;
};

/**
 * Read every connection file under `.zitadel/idps/`, in lexical order so a
 * duplicate report is stable. A missing directory reads as no connections:
 * the first provider a Project enables creates it.
 *
 * Unlike `readJsonDir`, this keeps each file's name. Every decision below is
 * reported to the developer in terms of the file they have to look at.
 */
export async function readConnectionFiles(cwd: string): Promise<ConnectionFile[]> {
  const dir = join(cwd, IDPS_DIR);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      return [];
    }
    throw error;
  }
  const files: ConnectionFile[] = [];
  for (const name of entries.filter((e) => e.endsWith(".json")).sort()) {
    const path = `${IDPS_DIR}/${name}`;
    let body: unknown;
    try {
      body = JSON.parse(await readFile(join(dir, name), "utf8"));
    } catch (error) {
      throw new ZitadelError("E_VALIDATION", `${path} is not valid JSON`, {
        hint: "Fix or remove the file, then run the command again.",
        details: { file: path, parse_error: String(error) },
      });
    }
    if (!isObject(body)) {
      throw new ZitadelError("E_VALIDATION", `${path} does not contain a JSON object`, {
        details: { file: path },
      });
    }
    files.push({ name, path, body });
  }
  return files;
}

/**
 * Whether a connection file describes the catalog entry's provider.
 *
 * Two independent signals, because either can be edited away: `template`
 * names the catalog entry the file was scaffolded from, and the OIDC issuer
 * identifies the provider itself. The issuer is the stronger signal — a file
 * pointing at Google is a Google connection whatever its template says — so a
 * disagreement still counts as a match and is left for the caller to report.
 */
function describesProvider(file: ConnectionFile, entry: IdpCatalogEntry): boolean {
  if (file.body.template === entry.template) {
    return true;
  }
  const issuer = (entry.protocol_block as { oidc?: { issuer?: string } }).oidc?.issuer;
  const oidc = file.body.oidc;
  return issuer !== undefined && isObject(oidc) && oidc.issuer === issuer;
}

/** The client id a connection file carries, whichever protocol it uses. */
function clientIdOf(file: ConnectionFile): string | undefined {
  for (const key of ["oidc", "oauth2"] as const) {
    const block = file.body[key];
    if (isObject(block) && typeof block.client_id === "string") {
      return block.client_id;
    }
  }
  return undefined;
}

/** What the caller should do with the provider's connection. */
export type ConnectionPlan =
  | { readonly action: "reuse"; readonly file: ConnectionFile; readonly slug: string }
  | { readonly action: "create"; readonly name: string; readonly path: string; readonly slug: string };

/**
 * Decide whether the provider already has a connection in this Project.
 *
 * Reuse is the default: a Project has one connection per provider, and a
 * second one for the same provider is nearly always an accident. Anything
 * ambiguous stops instead of guessing, because both alternatives — editing
 * the wrong connection, or silently adding a duplicate — are worse than
 * asking the developer which they meant.
 *
 * @param clientId - When given, a single match whose client id differs is a
 *   conflict rather than a reuse: the developer is pointing at a different
 *   OAuth application than the one already configured.
 */
export function planConnection(options: {
  readonly provider: string;
  readonly files: readonly ConnectionFile[];
  readonly clientId?: string;
}): ConnectionPlan {
  const entry = idpCatalogEntry(options.provider);
  const slug = options.provider;
  const matches = options.files.filter((file) => describesProvider(file, entry));

  if (matches.length > 1) {
    const names = matches.map((m) => m.path).join(", ");
    throw new ZitadelError("E_CONFLICT", `More than one ${entry.display_name} connection exists: ${names}`, {
      hint: "Keep the one this Project should use and remove the others, then run the command again.",
      details: { provider: options.provider, files: matches.map((m) => m.path) },
    });
  }

  const [match] = matches;
  if (match !== undefined) {
    const existing = clientIdOf(match);
    if (options.clientId !== undefined && existing !== undefined && existing !== options.clientId) {
      throw new ZitadelError(
        "E_VALIDATION",
        `${match.path} already uses client id ${existing}, not ${options.clientId}`,
        {
          hint: "Edit the connection file to change its client id, or run the command without one to reuse it.",
          details: { file: match.path, stored_client_id: existing, supplied_client_id: options.clientId },
        },
      );
    }
    const matchSlug = typeof match.body.slug === "string" ? match.body.slug : slug;
    return { action: "reuse", file: match, slug: matchSlug };
  }

  // No match. The scaffolded name is the slug, so an unrelated file already
  // sitting there would be overwritten — refuse rather than replace it.
  const name = `${slug}.json`;
  const path = `${IDPS_DIR}/${name}`;
  const occupied = options.files.find((file) => file.name === name);
  if (occupied !== undefined) {
    throw new ZitadelError("E_CONFLICT", `${path} already exists and is not a ${entry.display_name} connection`, {
      hint: "Rename or remove that file, then run the command again.",
      details: { file: path },
    });
  }
  return { action: "create", name, path, slug };
}
