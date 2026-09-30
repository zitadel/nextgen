import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  credentialVariables,
  type CredentialVariables,
  idpProvider,
  isVariableReference,
  referencedVariable,
  type IdpProvider,
} from "@zitadel/config/idp";

import { isErrno, ZitadelError } from "../errors";
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
function describesProvider(file: ConnectionFile, entry: IdpProvider): boolean {
  if (file.body.template === entry.template) {
    return true;
  }
  const oidc = file.body.oidc;
  return isObject(oidc) && oidc.issuer === entry.issuer;
}

/** The client id a connection file carries, whichever protocol it uses. */
function clientIdOf(file: ConnectionFile): string | undefined {
  return credentialOf(file, "client_id");
}

/** One credential field, from whichever protocol block the file carries. */
function credentialOf(file: ConnectionFile, field: "client_id" | "client_secret"): string | undefined {
  for (const key of ["oidc", "oauth2"] as const) {
    const block = file.body[key];
    if (isObject(block) && typeof block[field] === "string") {
      return block[field];
    }
  }
  return undefined;
}

/**
 * The variables a connection's credentials reference, falling back to the
 * names this CLI would have written.
 *
 * A connection is editable and may name its own variables, so publishing to a
 * slug-derived name would store the credential where the connection never
 * looks and report it as stored.
 */
export function credentialVariablesOf(
  file: ConnectionFile,
  slug: string,
): CredentialVariables {
  const named = (field: "client_id" | "client_secret", fallback: string): string => {
    const stored = credentialOf(file, field);
    return (stored === undefined ? undefined : referencedVariable(stored)) ?? fallback;
  };
  const scaffolded = credentialVariables(slug);
  return {
    clientId: named("client_id", scaffolded.clientId),
    clientSecret: named("client_secret", scaffolded.clientSecret),
  };
}

/**
 * Stop when another connection's credentials would land in the same variables.
 *
 * A slug may hold `-` and `_` (`^[a-z0-9][a-z0-9_-]*$`), and the variable name
 * replaces every non-alphanumeric with `_`, so `google-work` and `google_work`
 * both read `GOOGLE_WORK_CLIENT_SECRET`. Two connections sharing one variable
 * means whichever was published last wins and the other signs in with the
 * wrong application's credentials — a failure that surfaces at the provider,
 * not here. The derivation stays legible on purpose; the ambiguity is refused
 * instead, as this command refuses every other one.
 *
 * @param except - The connection being reused, which is not its own collision.
 */
function refuseCollidingVariables(
  slug: string,
  files: readonly ConnectionFile[],
  except?: ConnectionFile,
): void {
  const ours = credentialVariables(slug);
  for (const file of files) {
    if (file === except || typeof file.body.slug !== "string" || file.body.slug === slug) {
      continue;
    }
    const theirs = credentialVariables(file.body.slug);
    if (theirs.clientId !== ours.clientId && theirs.clientSecret !== ours.clientSecret) {
      continue;
    }
    throw new ZitadelError(
      "E_CONFLICT",
      `Slugs ${JSON.stringify(file.body.slug)} and ${JSON.stringify(slug)} both use ${ours.clientSecret}`,
      {
        hint: "Rename one of the connections' slugs so each has credentials of its own.",
        details: { file: file.path, slug, other_slug: file.body.slug, variable: ours.clientSecret },
      },
    );
  }
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
  const entry = idpProvider(options.provider);
  const slug = options.provider;
  const matches = options.files.filter((file) => describesProvider(file, entry));

  if (matches.length > 1) {
    const names = matches.map((m) => m.path).join(", ");
    throw new ZitadelError("E_CONFLICT", `More than one ${entry.displayName} connection exists: ${names}`, {
      hint: "Keep the one this Project should use and remove the others, then run the command again.",
      details: { provider: options.provider, files: matches.map((m) => m.path) },
    });
  }

  const [match] = matches;
  if (match !== undefined) {
    const existing = clientIdOf(match);
    // A scaffolded connection stores `${{ NAME }}`, not an id, so there is no
    // identity in the file to disagree with and the command stays idempotent.
    // A hand-written connection may still hold a literal, and that one is
    // worth refusing: rerunning with a different id would otherwise reuse a
    // file configured for another client.
    const literal = existing !== undefined && !isVariableReference(existing);
    if (options.clientId !== undefined && literal && existing !== options.clientId) {
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
    refuseCollidingVariables(matchSlug, options.files, match);
    return { action: "reuse", file: match, slug: matchSlug };
  }

  // No match. The scaffolded name is the slug, so an unrelated file already
  // sitting there would be overwritten — refuse rather than replace it.
  const name = `${slug}.json`;
  const path = `${IDPS_DIR}/${name}`;
  const occupied = options.files.find((file) => file.name === name);
  if (occupied !== undefined) {
    throw new ZitadelError("E_CONFLICT", `${path} already exists and is not a ${entry.displayName} connection`, {
      hint: "Rename or remove that file, then run the command again.",
      details: { file: path },
    });
  }
  refuseCollidingVariables(slug, options.files);
  return { action: "create", name, path, slug };
}
