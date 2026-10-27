import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  type ClientId,
  type ClientIdVariable,
  type ClientSecretVariable,
  type ConnectionSlug,
  credentialVariables,
  type CustomOidcInput,
  idpProvider,
  isVariableReference,
  parseConnectionSlug,
  type ProviderSelection,
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
        details: { file: path, parse_error: describeParseError(error) },
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
 * What went wrong parsing a file, without the text of the file. V8 quotes the
 * source it choked on, and this file is where a pasted secret would be.
 */
function describeParseError(error: unknown): string {
  const position = error instanceof Error ? /position (\d+)/.exec(error.message)?.[1] : undefined;
  return position === undefined ? "invalid JSON" : `invalid JSON at position ${position}`;
}

/**
 * Whether a connection file describes the catalog entry's provider.
 *
 * `template` names the catalog entry the file was scaffolded from. When it was
 * edited away, the file still counts if it carries the catalog's own slug and
 * issuer. A different slug on the same issuer is a custom connection that
 * happens to point at the provider, which a Project may hold alongside the
 * catalog one, so the catalog provider does not claim it.
 */
function describesProvider(file: ConnectionFile, entry: IdpProvider): boolean {
  if (file.body.template === entry.template) {
    return true;
  }
  const oidc = file.body.oidc;
  return (
    String(file.body.slug ?? "").trim() === entry.slug &&
    isObject(oidc) &&
    oidc.issuer === entry.issuer
  );
}

/** The client id a connection file carries. */
function clientIdOf(file: ConnectionFile): string | undefined {
  return credentialOf(file, "client_id");
}

/** One credential field, from the file's `oidc` block. */
function credentialOf(
  file: ConnectionFile,
  field: "client_id" | "client_secret",
): string | undefined {
  const block = file.body.oidc;
  return isObject(block) && typeof block[field] === "string" ? block[field] : undefined;
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
  slug: ConnectionSlug | undefined,
): StoredVariables {
  const scaffolded = slug === undefined ? undefined : credentialVariables(slug);
  return {
    clientId: named(file, "client_id", scaffolded?.clientId),
    clientSecret: named(file, "client_secret", scaffolded?.clientSecret),
  };
}

/**
 * The variable a credential field names, as the type of its fallback.
 *
 * A field absent from the file is where this command would have pointed it and
 * will point it now, so it reads as `fallback`, which is `undefined` when the
 * caller has no slug to derive one from. A field holding a literal is the value
 * itself: there is no variable behind it, and naming one would publish where
 * the connection never looks. Whatever a `client_id` field references is a
 * client id's variable, whatever it is called, which is what the brand records;
 * the type parameter keeps the two credentials from being swapped.
 */
function named<V extends string>(
  file: ConnectionFile,
  field: "client_id" | "client_secret",
  fallback: V | undefined,
): V | undefined {
  const value = credentialOf(file, field);
  return value === undefined ? fallback : (referencedVariable(value) as V | undefined);
}

/**
 * The variables a connection on disk actually uses.
 *
 * `undefined` for a credential the file holds as a literal: an editable
 * connection may carry a real client id rather than a reference, and that value
 * is not read from anywhere, so there is nothing to publish to and nothing for
 * another connection to collide with.
 */
export type StoredVariables = {
  readonly clientId: ClientIdVariable | undefined;
  readonly clientSecret: ClientSecretVariable | undefined;
};

/**
 * Stop when a connection document hands back a credential value.
 *
 * `client_secret` is always a `${{ NAME }}` reference — the syncer refuses to
 * upload anything else — so a value here is the server having resolved the
 * reference. Every path that reaches this has somewhere worse to put it than a
 * log: a plan preview prints it, and a file written from it would commit it to
 * `.zitadel/idps/`, which is the one place the secret must never reach.
 */
export function refuseResolvedSecret(definition: object, id: string): void {
  const block = (definition as Record<string, unknown>).oidc;
  const stored = isObject(block) ? block.client_secret : undefined;
  if (typeof stored === "string" && !isVariableReference(stored)) {
    throw new ZitadelError("E_VALIDATION", `${id} came back holding a client_secret value`, {
      hint:
        "A stored connection must keep the ${{ NAME }} reference. Report this: the endpoint " +
        "is resolving secrets, and the value would be written to disk.",
      details: { id, block: "oidc" },
    });
  }
}

/**
 * Stop when two connections' credentials would land in the same variable.
 *
 * Two ways that happens. A slug may hold `-` and `_`
 * (`^[a-z0-9][a-z0-9_-]*$`) and the variable name replaces every
 * non-alphanumeric with `_`, so `google-work` and `google_work` both read
 * `GOOGLE_WORK_CLIENT_SECRET`. And a connection is editable, so one may simply
 * point at a name another already uses, or point both of its own credentials
 * at one name. Either way a publish overwrites what the other credential put
 * there, and the loser signs in with the wrong application — a failure that
 * surfaces at the provider, not here.
 *
 * What an existing file *references* is what counts, not what its slug would
 * derive: an `okta` connection referencing `GOOGLE_CLIENT_SECRET` collides
 * with Google however its slug reads.
 *
 * The derivation stays legible on purpose — these names get typed into
 * `variable set` by hand — so the ambiguity is refused rather than encoded
 * around.
 *
 * @param ours - The variables this run will publish to.
 * @param except - The connection being reused, which is not its own collision.
 */
function refuseCollidingVariables(
  ours: StoredVariables,
  slug: ConnectionSlug,
  files: readonly ConnectionFile[],
  except?: ConnectionFile,
): void {
  // The one place the two kinds of name are compared on purpose: both credentials
  // pointing at the same variable.
  if (ours.clientId !== undefined && (ours.clientId as string) === ours.clientSecret) {
    throw new ZitadelError(
      "E_CONFLICT",
      `This connection points both credentials at ${ours.clientId}`,
      {
        hint: "Give client_id and client_secret separate ${{ NAME }} references, then run the command again.",
        details: { slug, variable: ours.clientId },
      },
    );
  }
  for (const file of files) {
    if (file === except) {
      continue;
    }
    // A file with no usable slug has no derived names, but what it references
    // explicitly is still read, however its slug reads.
    const theirSlug = parseConnectionSlug(String(file.body.slug ?? ""));
    const theirs = credentialVariablesOf(file, theirSlug.ok ? theirSlug.value : undefined);
    // A literal on either side names no variable, so it cannot collide.
    const shared = [ours.clientId, ours.clientSecret].find(
      (name) => name !== undefined && (name === theirs.clientId || name === theirs.clientSecret),
    );
    if (shared === undefined) {
      continue;
    }
    throw new ZitadelError("E_CONFLICT", `${file.path} and ${slug} both use ${shared}`, {
      hint: "Point one of them at a variable of its own, then run the command again.",
      details: {
        file: file.path,
        slug,
        other_slug: theirSlug.ok ? theirSlug.value : String(file.body.slug ?? ""),
        variable: shared,
      },
    });
  }
}

/** What the caller should do with the provider's connection. */
export type ConnectionPlan =
  | {
      readonly action: "reuse";
      readonly file: ConnectionFile;
      readonly slug: ConnectionSlug;
      /** Settings the developer gave that the existing file does not have, and so were not applied. */
      readonly notApplied?: readonly ("display name" | "scopes")[];
    }
  | {
      readonly action: "create";
      readonly name: string;
      readonly path: string;
      readonly slug: ConnectionSlug;
      /** Files that already connect to this provider's issuer under another slug. */
      readonly alsoUsesIssuer?: readonly string[];
    };

/**
 * Decide whether a catalog provider already has a connection in this Project.
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
function planCatalogConnection(options: {
  readonly provider: IdpProvider;
  readonly files: readonly ConnectionFile[];
  readonly clientId?: ClientId;
  /** How the calling command spells the slug flag, for the hints. */
  readonly slugFlag: string;
}): ConnectionPlan {
  const entry = options.provider;
  const slug = entry.slug;
  const matches = options.files.filter((file) => describesProvider(file, entry));

  if (matches.length > 1) {
    const names = matches.map((m) => m.path).join(", ");
    throw new ZitadelError(
      "E_CONFLICT",
      `More than one ${entry.displayName} connection exists: ${names}`,
      {
        hint: "Keep the one this Project should use and remove the others, then run the command again.",
        details: { provider: slug, files: matches.map((m) => m.path) },
      },
    );
  }

  const [match] = matches;
  if (match !== undefined) {
    refuseDifferentClientId(match, options.clientId);
    // A file can match on template or issuer while carrying no slug of its
    // own. Inventing the provider's would point the schema and every flow at
    // an identity the connection does not declare, and the server rejects the
    // connection on the next apply for want of it.
    const matchSlug = parseConnectionSlug(String(match.body.slug ?? ""));
    if (!matchSlug.ok) {
      throw new ZitadelError(
        "E_VALIDATION",
        `${match.path} is a ${entry.displayName} connection with no usable slug`,
        {
          hint: "Give the connection file a slug -- the schemas and flows reference it by that name.",
          details: { file: match.path, problem: matchSlug.problem },
        },
      );
    }
    refuseCollidingVariables(
      credentialVariablesOf(match, matchSlug.value),
      matchSlug.value,
      options.files,
      match,
    );
    return { action: "reuse", file: match, slug: matchSlug.value };
  }

  // No match. The scaffolded name is the slug, so an unrelated file already
  // sitting there would be overwritten — refuse rather than replace it.
  const name = `${slug}.json`;
  const path = `${IDPS_DIR}/${name}`;
  const occupied = options.files.find((file) => file.name === name);
  if (occupied !== undefined) {
    const theirSlug = String(occupied.body.slug ?? "").trim();
    // The same name on a connection to somewhere else is not the provider's.
    throw new ZitadelError(
      "E_CONFLICT",
      theirSlug === slug
        ? `${path} is a connection called ${slug}, but not to ${entry.displayName}: its issuer is not ${entry.issuer}`
        : `${path} already exists and its slug is ${theirSlug === "" ? "missing" : theirSlug}, not ${slug}`,
      {
        hint:
          theirSlug === slug
            ? `Point it at ${entry.displayName} if it is that connection. Otherwise change its slug, in the file and in the schemas and flows that name it, then run the command again.`
            : `Rename or remove that file, or give it the slug ${slug} if it is the ${entry.displayName} connection, then run the command again.`,
        details: { file: path, slug: occupied.body.slug ?? null },
      },
    );
  }
  refuseCollidingVariables(credentialVariables(slug), slug, options.files);
  // A hand-written connection to the same issuer under another slug is not
  // claimed, so this adds a second button for the provider. Say so.
  const alsoUsesIssuer = options.files
    .filter((file) => isObject(file.body.oidc) && file.body.oidc.issuer === entry.issuer)
    .map((file) => file.path);
  return {
    action: "create",
    name,
    path,
    slug,
    ...(alsoUsesIssuer.length > 0 ? { alsoUsesIssuer } : {}),
  };
}

/**
 * Stop when the developer names a client id other than the one a connection
 * already holds.
 *
 * A scaffolded connection stores `${{ NAME }}`, not an id, so there is no
 * identity in the file to disagree with and the command stays idempotent.
 * A hand-written connection may still hold a literal, and that one is
 * worth refusing: rerunning with a different id would otherwise reuse a
 * file configured for another client.
 */
function refuseDifferentClientId(match: ConnectionFile, clientId: ClientId | undefined): void {
  const existing = clientIdOf(match);
  const literal = existing !== undefined && !isVariableReference(existing);
  if (clientId !== undefined && literal && existing !== clientId) {
    throw new ZitadelError(
      "E_VALIDATION",
      `${match.path} already uses client id ${existing}, not ${clientId}`,
      {
        hint: "Edit the connection file to change its client id, or run the command without one to reuse it.",
        details: {
          file: match.path,
          stored_client_id: existing,
          supplied_client_id: clientId,
        },
      },
    );
  }
}

/**
 * Decide what to do with a custom connection, identified by the slug the
 * developer supplied.
 *
 * Unlike {@link planConnection} this never looks at the template or the
 * issuer to find a connection: a Project may hold several connections to one
 * issuer, with different credentials or mappings, and what tells them apart
 * is the name. The slug is also what schemas and flows reference, so it is
 * the only thing that can say "the same connection".
 *
 * A slug already in use is reused only when it is the same provider — the
 * same issuer — so that repeating a command changes nothing. The same name on
 * a connection to somewhere else is somebody else's, and replacing it would
 * repoint every schema and flow that names it.
 */
/**
 * What a custom connection's slug alone decides: the file it already names, or
 * a refusal. More than one file with the slug, or a file name the slug would
 * take that holds another connection, or variable names a new connection would
 * collide on, are all knowable before anything else about the connection is, so
 * a command can raise them as soon as it has the slug.
 *
 * @returns The single file that declares the slug, or `undefined` when the
 *   slug is free and a new connection can be created.
 */
export function checkCustomSlug(
  files: readonly ConnectionFile[],
  slug: ConnectionSlug,
  slugFlag: string,
): ConnectionFile | undefined {
  const name = `${slug}.json`;
  const path = `${IDPS_DIR}/${name}`;
  const holders = files.filter((file) => String(file.body.slug ?? "").trim() === slug);

  if (holders.length > 1) {
    throw new ZitadelError(
      "E_CONFLICT",
      `More than one connection is named ${slug}: ${holders.map((h) => h.path).join(", ")}`,
      {
        hint: "A slug names one connection. Remove or rename all but one, then run the command again.",
        details: { slug, files: holders.map((h) => h.path) },
      },
    );
  }

  const [match] = holders;
  if (match !== undefined) {
    return match;
  }
  // Nothing declares the slug, but the file name is where this one would go.
  if (files.some((file) => file.name === name)) {
    throw new ZitadelError(
      "E_CONFLICT",
      `${path} already exists and is not the ${slug} connection`,
      {
        hint: `Rename or remove that file, or choose another ${slugFlag}, then run the command again.`,
        details: { file: path, slug },
      },
    );
  }
  refuseCollidingVariables(credentialVariables(slug), slug, files);
  return undefined;
}

function planCustomConnection(options: {
  readonly input: CustomOidcInput;
  readonly files: readonly ConnectionFile[];
  readonly clientId?: ClientId;
  /** Whether `--scopes` was passed: a default nobody asked for has not been contradicted. */
  readonly scopesGiven?: boolean;
  /** How the calling command spells the slug flag, for the hints. */
  readonly slugFlag: string;
}): ConnectionPlan {
  const { slug, issuer } = options.input;
  const name = `${slug}.json`;
  const path = `${IDPS_DIR}/${name}`;
  const match = checkCustomSlug(options.files, slug, options.slugFlag);
  if (match === undefined) {
    return { action: "create", name, path, slug };
  }

  const oidc = match.body.oidc;
  const existingIssuer =
    isObject(oidc) && typeof oidc.issuer === "string" ? oidc.issuer : undefined;
  if (existingIssuer !== issuer) {
    throw new ZitadelError(
      "E_CONFLICT",
      existingIssuer === undefined
        ? `${match.path} is already named ${slug} and is not an OIDC connection to ${issuer}`
        : `${match.path} is already named ${slug} and connects to ${existingIssuer}, not ${issuer}`,
      {
        hint: `An applied connection keeps its issuer, and the server compares it exactly, so even a trailing slash names another provider. Choose another ${options.slugFlag} for this connection, then move the schemas and flows that name the old one to it.`,
        details: { file: match.path, slug, issuer, existing_issuer: existingIssuer ?? null },
      },
    );
  }
  refuseDifferentClientId(match, options.clientId);
  refuseCollidingVariables(credentialVariablesOf(match, slug), slug, options.files, match);
  const storedScopes = isObject(oidc) && Array.isArray(oidc.scopes) ? oidc.scopes.join(" ") : "";
  const notApplied = [
    ...(match.body.display_name === options.input.displayName ? [] : (["display name"] as const)),
    ...(options.scopesGiven !== true || storedScopes === options.input.scopes.join(" ")
      ? []
      : (["scopes"] as const)),
  ];
  return { action: "reuse", file: match, slug, ...(notApplied.length > 0 ? { notApplied } : {}) };
}

/**
 * The settings a custom connection's file holds, as written, for the ones it
 * has. Nothing is checked here: a hand-edited file may hold anything.
 */
export function storedCustomSettings(file: ConnectionFile): {
  displayName?: string;
  issuer?: string;
  scopes?: string;
} {
  const oidc = file.body.oidc;
  return {
    ...(typeof file.body.display_name === "string" ? { displayName: file.body.display_name } : {}),
    ...(isObject(oidc) && typeof oidc.issuer === "string" ? { issuer: oidc.issuer } : {}),
    ...(isObject(oidc) && Array.isArray(oidc.scopes) ? { scopes: oidc.scopes.join(" ") } : {}),
  };
}

/**
 * Decide what to do with the connection for a provider in this Project.
 *
 * A catalog provider has one connection, found by what it is. Reuse is the
 * default: a second one for the same provider is nearly always an accident.
 * A custom connection is found by the slug the developer gave it, because a
 * Project may hold several connections to one issuer and the name is the only
 * thing that tells them apart.
 *
 * Anything ambiguous stops instead of guessing, because both alternatives —
 * editing the wrong connection, or silently adding a duplicate — are worse
 * than asking the developer which they meant.
 *
 * @param clientId - When given, a single match whose client id differs is a
 *   conflict rather than a reuse: the developer is pointing at a different
 *   OAuth application than the one already configured.
 */
export function planConnection(options: {
  readonly selection: ProviderSelection;
  readonly files: readonly ConnectionFile[];
  readonly clientId?: ClientId;
  readonly scopesGiven?: boolean;
  /** How the calling command spells the slug flag, for the hints. */
  readonly slugFlag: string;
}): ConnectionPlan {
  const { selection, files, clientId, scopesGiven, slugFlag } = options;
  return selection.kind === "custom"
    ? planCustomConnection({ input: selection.connection, files, clientId, scopesGiven, slugFlag })
    : planCatalogConnection({ provider: idpProvider(selection.id), files, clientId, slugFlag });
}
