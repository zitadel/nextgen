import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import * as endpoints from "@zitadel/api/generated/endpoints/zitadelNextGen";
import { destructiveOperations } from "@zitadel/api/generated/operations";
import { describe, expect, it } from "vitest";

import { RESOURCES } from "../../../src/commands/resources";

/**
 * The registry is hand-maintained, so an operation the API gains is invisible
 * to the CLI until somebody adds an entry. This test is the thing that notices.
 *
 * Its source of truth is the generated client, because that is the real
 * constraint: the registry can only call what orval generated. Every operation
 * is an exported function paired with an exported URL builder, so both the
 * operations and the collection each belongs to are read by calling them —
 * nothing parses a specification, and nothing infers a verb from a function's
 * name.
 *
 * What the CLI *uses* is read the same way: each registry verb is invoked
 * against a recording client, so the comparison is between the calls the
 * commands really make and the calls the client really offers. Everything the
 * client offers must be either called or listed below with a reason.
 */

/**
 * Collections the API itself declares to be resources, by giving them a
 * structured query endpoint: ADR 031 introduces `POST /<collection>/query`
 * precisely "to indicate a customer wants to query a resource". These are
 * therefore not a judgement call and accept no exclusion — see the test below.
 *
 * The converse does not hold. Several resources here still list through `GET`
 * (recorded as an open question in ADR 064), so a collection without a query
 * endpoint may or may not be a resource, and that is where a person decides.
 */
const queryCollections = (operations: ClientOperations): ReadonlySet<string> =>
  new Set(
    [...operations].flatMap(([operation, collection]) =>
      urlOf(operation).endsWith("/query") ? collection : [],
    ),
  );

/** Collections with no resource commands at all, and why. */
const NOT_RESOURCES: Readonly<Record<string, string>> = {
  livez: "liveness probe, not a resource",
  readyz: "readiness probe, not a resource",
  flow: "the runtime login flow protocol, driven by the login UI and the SDKs",
  auth_attempts: "the runtime authentication protocol, driven by the login UI and the SDKs",
  // Deployments are acts, not files: creating one is `zitadel deploy`'s
  // orchestration (build the release, then make it live — ADR 035), and the
  // history is that command's to read. Registry CRUD would offer a `create`
  // that skips the release construction the command exists to do.
  deployments: "created and read through `zitadel deploy` orchestration, not registry CRUD (#529)",
};

/**
 * Operations of a covered collection that the resource commands deliberately
 * do not call, and why. Anything absent from both this list and the registry
 * is drift.
 */
const NOT_CALLED: Readonly<Record<string, string>> = {
  // Bootstrap and the claim flow belong to their own commands.
  createProject:
    "unauthenticated bootstrap minting secrets; `zitadel setup` and `zitadel env add` own it",
  initClaim: "the browser claim flow; `zitadel claim` calls it",
  getClaimStatus: "the browser claim flow; `zitadel claim` calls it",
  // These two are reached by nothing in the CLI at all — not the registry, not
  // `zitadel claim`. Either the claim flow is incomplete or they are dead
  // generated surface; recorded as a question rather than implied to be owned.
  completeClaim: "part of the claim flow, but currently called by no command — unresolved",
  getClaimWindow: "part of the claim flow, but currently called by no command — unresolved",
  // A preview exists only through a deployment to it, so it has no create to
  // offer; listing and removing it are `zitadel preview`'s.
  listPreviews: "previews are listed by `zitadel preview` (#1312)",
  removePreview: "previews are removed by `zitadel preview` (#1312)",

  // Individual resource writes are not made here: `deploy` sends the whole
  // `.zitadel/` as one release bundle (ADR 035), so the per-kind create
  // endpoints are never called by the CLI.
  createSchema: "configuration is written from .zitadel/ as a release bundle (deploy, ADR 035)",
  createBranding: "configuration is written from .zitadel/ as a release bundle (deploy, ADR 035)",
  // `deploy` builds a release from the `.zitadel/` bundle via `buildRelease`
  // (`POST /releases/build`); pinning pre-existing revision ids with
  // `createRelease` is not a CLI flow.
  createRelease:
    "the CLI builds from a bundle via buildRelease, not by pinning revision ids (ADR 035)",
  createFlowDefinition:
    "configuration is written from .zitadel/ as a release bundle (deploy, ADR 035)",

  // End-user self-service, authenticated as that user. The CLI holds an
  // operator credential (ADR 036), so these are not its to call.
  getMyUser: "the end user's own view of themselves, on their own credential",
  patchMyUser: "the end user's own view of themselves, on their own credential",
  getMyUserSchema: "the end user's own view of themselves, on their own credential",
  listMyTeams: "the end user's own view of themselves, on their own credential",
  listMyPasskeys: "the end user's own view of themselves, on their own credential",
  listMyIdentityLinks: "the end user's own view of themselves, on their own credential",
  getMyPasswordState: "the end user's own view of themselves, on their own credential",
  getMySession: "the end user's own session, on their own credential",
  getMySessionCsrfToken:
    "the session's CSRF token (ADR 053 §5), read on the session's own credential; only the local-admin claim helper, not a command, uses it",
  listMyProjects: "the projects the signed-in user can act on, read on their own credential",
  revokeMySession: "the end user's own session, on their own credential",

  // Session and passkey protocol, driven by the SDKs and the login flow.
  createSession: "a session is minted for an end user by the SDKs and the login flow",
  exchangeHandoff: "part of the login handoff protocol",
  beginUserPasskeyRegistration:
    "WebAuthn registration needs an authenticator, which a terminal is not",
  finishUserPasskeyRegistration:
    "WebAuthn registration needs an authenticator, which a terminal is not",

  // ADR 063's revision routes. The CLI has no grammar for a sub-resource
  // listing (`idps revisions <id>`) and inventing verbs for one resource is
  // what ADR 064 §4 rules out, so these wait for that shape to be decided.
  listIdpRevisions: "sub-resource listing; the CLI has no grammar for it yet (ADR 063)",
  // Policies are written from .zitadel/policies/ by `deploy` (ADR 066).
  publishPolicy: "configuration: `deploy` publishes .zitadel/policies/ in the release bundle",
  listPolicyRevisions: "sub-resource listing; same grammar question as `listIdpRevisions`",
  getPolicyRevision: "reads one revision by revision id; same shape question as above",
  getIdpRevisionById: "reads one revision by revision id; same shape question as above",
  evaluatePolicy:
    "a dry run `policies test` sends per case from lib/policies/tests.ts; no registry verb evaluates",

  // Known gaps, recorded rather than hidden. These are additive and tracked as
  // a follow-up; they are listed here so adding one is a deliberate act.
  setUserPassword: "not yet exposed — follow-up, needs a credential-safe input route (ADR 064 §12)",
  listUserTeams: "not yet exposed — follow-up, a user sub-resource listing",
  listUserPasskeys: "not yet exposed — follow-up, a user sub-resource listing",
  listUserIdentityLinks: "not yet exposed — follow-up, a user sub-resource listing",
  getUserPasswordState: "not yet exposed — follow-up, a user sub-resource read",
  addOrigin: "not yet exposed — `zitadel origin add` lands with the origins CLI surface (#1578)",
  removeOrigin:
    "not yet exposed — `zitadel origin remove` lands with the origins CLI surface (#1578)",
  listProjectAdmins: "not yet exposed; a project sub-resource listing, no command reads it yet",
};

const capitalize = (word: string): string => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`;

type ClientOperations = ReadonlyMap<string, string>;

/**
 * Every operation the generated client exposes, mapped to its collection. The
 * collection comes from calling the operation's URL builder with placeholder
 * arguments and taking the first path segment, so a sub-resource
 * (`/users/{id}/passkeys`) counts against its parent.
 */
/** The path an operation addresses, with placeholder path parameters. */
const urlOf = (operation: string): string => {
  const module = endpoints as unknown as Record<string, unknown>;
  const build = module[`get${capitalize(operation)}Url`];
  expect(typeof build, `no URL builder paired with ${operation}`).toBe("function");
  return String((build as (...args: unknown[]) => string)("ID", "NAME")).replace(/\?.*$/, "");
};

const clientOperations = (): ClientOperations => {
  const module = endpoints as unknown as Record<string, unknown>;
  const isUrlBuilder = (name: string) => /^get[A-Z].*Url$/.test(name);
  const operations = Object.keys(module).filter(
    (name) => typeof module[name] === "function" && !isUrlBuilder(name),
  );
  expect(operations.length, "no operations found in the generated client").toBeGreaterThan(20);

  return new Map(
    // orval pairs every operation with a URL builder; `urlOf` fails if that
    // ever stops being true, rather than silently skipping the operation.
    operations.map((operation) => [operation, urlOf(operation).split("/")[1] ?? ""]),
  );
};

/**
 * Placeholder arguments covering the shapes a positional can take: a plain
 * name, a prefixed resource id, and a URI id.
 */
const REFS = ["ID", "sch_1", "flowdef_1", "pol_1", "https://example.com/schema.json"] as const;

/**
 * Collections served by hand-written commands rather than the registry, with
 * the command files that serve them.
 *
 * Variables sit outside the registry's grammar: a variable has no id, the list
 * is a map keyed by name rather than rows, and the write is one RFC 7386 merge
 * where `null` removes — an upsert, which is why the commands use `set` rather
 * than create and update, as `gh variable set` does (ADR 062, ADR 064).
 * `variable resolve` reads a deployment's frozen map, which is a deployment
 * operation served by a variable command.
 */
const STANDALONE: Readonly<Record<string, readonly string[]>> = {
  variables: ["variable/set", "variable/get", "variable/list", "variable/rm", "variable/resolve"],
  // Origins are nested under a project rather than a root collection, so they
  // have no `/origins/query` grammar; the hand-written commands add, list (off
  // the project) and remove one pattern at a time.
  origin: ["origin/add", "origin/list", "origin/rm"],
  // A release is built from `.zitadel/` and posted as one bundle (`deploy`,
  // `release create`), looked up and revoked by id. The registry serves
  // `release list`/`get`; the acts of building and revoking are these.
  releases: ["deploy", "release/create", "release/revoke"],
  // A deployment is an act, not a file: `deploy` and `deployment create` make a
  // release live, `deployment list`/`get` read the history, `deployment
  // rollback` re-applies one. The operations live in the `lib/release` wrappers
  // these commands call, which {@link standaloneOperations} scans too.
  deployments: ["deployment/create", "deployment/list", "deployment/get", "deployment/rollback"],
  // A preview is written by a preview deployment, not created directly: `preview`
  // deploys to the preview URLs, `preview list` reads the live ones and
  // `preview rm` removes one. `preview` reaches the release/deployment
  // operations through the `lib/release` wrappers scanned above.
  previews: ["preview/index", "preview/list", "preview/rm"],
};

/**
 * The publish-pipeline modules the deploy/release/deployment commands call into.
 * Their `client.<operation>(` call sites are the evidence those commands reach
 * the release and deployment operations, the same way a command's own call site
 * is for the registry.
 */
const PIPELINE_SOURCES: readonly string[] = [
  "lib/release/release.ts",
  "lib/release/deployment.ts",
  "lib/release/steps/diff.ts",
  "lib/release/steps/idp-checks.ts",
];

/**
 * The client operations each standalone command calls, read from its source
 * and keyed by its command (`variables set`). The registry's evidence is which
 * client properties its verbs touch; a `client.<operation>(` call site, or a
 * destructive one's `consent.unlock(client).<operation>(`, is the same evidence, so a command that stops calling an operation leaves that
 * operation unaccounted and this test fails. The release and deployment
 * commands reach their operations through the pipeline modules above.
 */
const standaloneCommandOperations = async (): Promise<ReadonlyMap<string, ReadonlySet<string>>> => {
  const callsIn = async (path: string): Promise<string[]> =>
    [...(await readFile(path, "utf8")).matchAll(/\bclient\)?\s*\.(\w+)\(/g)].map(
      (m) => m[1] as string,
    );
  const pipeline = (
    await Promise.all(
      PIPELINE_SOURCES.map((file) => callsIn(join(import.meta.dirname, "../../../src", file))),
    )
  ).flat();
  return new Map(
    await Promise.all(
      Object.entries(STANDALONE).flatMap(([group, commands]) =>
        commands.map(async (command): Promise<[string, ReadonlySet<string>]> => {
          const own = await callsIn(
            join(import.meta.dirname, "../../../src/commands", `${command}.ts`),
          );
          const viaPipeline = group === "releases" || group === "deployments" ? pipeline : [];
          return [command.replaceAll("/", " "), new Set([...own, ...viaPipeline])];
        }),
      ),
    ),
  );
};

/** The client operations the standalone commands call. */
const standaloneOperations = async (): Promise<ReadonlySet<string>> =>
  new Set([...(await standaloneCommandOperations()).values()].flatMap((called) => [...called]));

/** The client operations each registry verb invokes, keyed by its command (`teams deactivate`). */
const verbOperations = async (): Promise<ReadonlyMap<string, ReadonlySet<string>>> => {
  const operations = new Map<string, ReadonlySet<string>>();

  for (const [topic, resource] of Object.entries(RESOURCES)) {
    const verbs = resource as unknown as Record<
      string,
      { verb?: string; call?: (...args: never[]) => Promise<unknown> } | undefined
    >;
    for (const verb of ["list", "get", "create", "update", "delete"] as const) {
      const spec = verbs[verb];
      if (!spec?.call) continue;
      const called = new Set<string>();
      const client = new Proxy({} as Record<string, unknown>, {
        get: (_target, property) => {
          called.add(String(property));
          return () => Promise.resolve({});
        },
      });
      const context = { client, projectId: "proj_test" } as never;
      // A verb may branch on the shape of its argument — a schema is addressed
      // by revision id or by object type — so every branch is driven, or the
      // client call behind the untaken one would look unused. The recording
      // client resolves `{}`, so a call that inspects its response throws;
      // only the property that was reached matters, so the throw is discarded.
      // A delete reaches the client through its consent, which hands it back.
      const consent = { unlock: (unlocked: unknown) => unlocked };
      for (const ref of REFS) {
        await spec.call(context, ref as never, consent as never).catch(() => undefined);
      }
      // A delete may be named after what it does instead (`deactivate`).
      operations.set(`${topic} ${verb === "delete" ? (spec.verb ?? verb) : verb}`, called);
    }
  }
  return operations;
};

/** The client operations the registry's verbs actually invoke. */
const calledOperations = async (): Promise<ReadonlySet<string>> =>
  new Set([...(await verbOperations()).values()].flatMap((called) => [...called]));

const SPEC_ENDPOINTS = join(import.meta.dirname, "../../../../../api/openapi/endpoints");

/**
 * The command the spec names for each client operation: the `x-zitadel-cli`
 * line that follows the operation's `operationId` in the `methods.yaml` files
 * under api/openapi/endpoints. The API reference shows that command
 * beside the operation, so it has to be one the CLI really runs. The line is
 * read where the convention puts it rather than through a YAML parser, and an
 * annotation anywhere else fails instead of going unread.
 */
const specCommands = async (): Promise<ReadonlyMap<string, string>> => {
  const files = (await readdir(SPEC_ENDPOINTS, { recursive: true })).filter((file) =>
    file.endsWith("methods.yaml"),
  );
  expect(files.length, "no methods.yaml found under api/openapi/endpoints").toBeGreaterThan(20);

  const commands = new Map<string, string>();
  for (const file of files) {
    const source = await readFile(join(SPEC_ENDPOINTS, file), "utf8");
    const named = [...source.matchAll(/^( +)operationId: *(\S+) *\n\1x-zitadel-cli: *(.+?) *$/gm)];
    expect(
      named.length,
      `${file}: every x-zitadel-cli goes on the line right after its operation's operationId`,
    ).toBe(source.match(/^ *x-zitadel-cli:/gm)?.length ?? 0);
    for (const [, , operationId = "", command = ""] of named) {
      // orval names the client function after the operationId, camel-cased.
      commands.set(`${operationId.charAt(0).toLowerCase()}${operationId.slice(1)}`, command);
    }
  }
  return commands;
};

describe("the CLI covers the API client", () => {
  it("calls, or explains, every operation the client offers", async () => {
    const called = await calledOperations();
    const standalone = await standaloneOperations();
    const unaccounted = [...clientOperations()]
      .filter(([operation, collection]) => {
        if (called.has(operation) || standalone.has(operation) || operation in NOT_CALLED) {
          return false;
        }
        return !(collection in NOT_RESOURCES);
      })
      .map(([operation]) => operation);

    expect(
      unaccounted,
      `The API client offers operations the CLI neither calls nor explains: ${unaccounted.join(", ")}. ` +
        "Add or extend a registry entry in src/commands/resources.ts, call it from a command listed " +
        "in STANDALONE, or add the operation to NOT_CALLED in this test with the reason it stays unexposed.",
    ).toEqual([]);
  });

  it("has a registry entry, or a reason, for every collection", async () => {
    const topics = new Set(Object.keys(RESOURCES).map((topic) => topic.replaceAll("-", "_")));
    const unaccounted = [...new Set(clientOperations().values())].filter(
      (collection) =>
        !topics.has(collection) && !(collection in NOT_RESOURCES) && !(collection in STANDALONE),
    );

    expect(
      unaccounted,
      `The API client reaches collections the CLI neither exposes nor explains: ${unaccounted.join(", ")}. ` +
        "Add a registry entry, or add the collection to NOT_RESOURCES with the reason it has no commands.",
    ).toEqual([]);
  });

  it("exposes every collection the API itself calls a resource", () => {
    // A query endpoint is the API declaring this to be a resource (ADR 031),
    // so unlike the checks above this one accepts no reason: the answer is not
    // a judgement, and a new resource that follows the convention is detected
    // without anyone having to classify it.
    const operations = clientOperations();
    const topics = new Set(Object.keys(RESOURCES).map((topic) => topic.replaceAll("-", "_")));
    const missing = [...queryCollections(operations)].filter(
      (collection) => !topics.has(collection),
    );

    expect(
      missing,
      `These collections have POST /<collection>/query, which ADR 031 defines as a resource, ` +
        `but the CLI has no registry entry for them: ${missing.join(", ")}. They need commands, not an exclusion.`,
    ).toEqual([]);

    // The same fact, guarded from the other side: none of them may be waved
    // through as "not a resource".
    for (const collection of queryCollections(operations)) {
      expect(
        collection in NOT_RESOURCES,
        `"${collection}" has a query endpoint, so it cannot be listed in NOT_RESOURCES`,
      ).toBe(false);
    }
  });

  it("calls nothing the client does not offer", async () => {
    const operations = clientOperations();
    const invented = [...(await calledOperations())].filter(
      (operation) => !operations.has(operation),
    );
    expect(invented, "the registry calls client methods that do not exist").toEqual([]);
  });

  it("keeps every stated reason pointed at something real", async () => {
    // A reason that outlives its operation describes a world that no longer
    // exists, which is how a stale exclusion list hides real drift.
    const operations = clientOperations();
    const called = await calledOperations();

    for (const operation of Object.keys(NOT_CALLED)) {
      expect(
        operations.has(operation),
        `NOT_CALLED lists "${operation}", which the client no longer offers`,
      ).toBe(true);
      expect(
        called.has(operation),
        `NOT_CALLED lists "${operation}", but the CLI now calls it — delete the entry`,
      ).toBe(false);
    }
    for (const collection of Object.keys(NOT_RESOURCES)) {
      expect(
        [...operations.values()].includes(collection),
        `NOT_RESOURCES lists "${collection}", which the client no longer reaches`,
      ).toBe(true);
    }
  });
});

/**
 * Commands that call no operation of their own, with the command the reference
 * shows for the operation they share. An operation carries one
 * `x-zitadel-cli` line, so where two commands drive the same endpoint the line
 * names the one a developer reaches for first, and the other is listed here
 * with the reason. Checked below against what the commands really call, so an
 * entry cannot outlive the sharing that justifies it.
 */
const SHARES_OPERATION: Readonly<Record<string, string>> = {
  // Reads the project to resolve the preview URLs it deploys to; the deploy
  // itself is `POST /deployments`, which names `deployment create`.
  "preview index": "projects get",
  // Builds a release from `.zitadel/` exactly as `deploy` does, without
  // deploying it, so `POST /releases/build` names `deploy`.
  "release create": "deploy",
  // Reads the project to report its origin patterns; `projects get` is the
  // command the reference shows for `GET /projects/{id}`.
  "origin list": "projects get",
};

describe("the spec names the command behind each operation", () => {
  it("names one operation of every command with that command", async () => {
    const named = await specCommands();
    const commands = new Map([
      ...(await verbOperations()),
      ...(await standaloneCommandOperations()),
    ]);
    const unnamed = [...commands]
      .filter(([command]) => !(command in SHARES_OPERATION))
      .filter(
        ([command, called]) => [...called].filter((op) => named.get(op) === command).length !== 1,
      )
      .map(([command, called]) => `${command} (calls ${[...called].join(", ")})`);

    expect(
      unnamed,
      `Commands the API reference cannot show beside their operation: ${unnamed.join("; ")}. ` +
        "In api/openapi/endpoints, give exactly one operation each command calls an " +
        "`x-zitadel-cli: <command>` line right after its operationId.",
    ).toEqual([]);
  });

  it("keeps every shared-operation reason pointed at something real", async () => {
    const named = await specCommands();
    const commands = new Map([
      ...(await verbOperations()),
      ...(await standaloneCommandOperations()),
    ]);

    for (const [command, shownAs] of Object.entries(SHARES_OPERATION)) {
      const called = commands.get(command);
      expect(called, `SHARES_OPERATION lists "${command}", which is not a command`).toBeDefined();
      const shared = [...(called ?? [])].filter((operation) => named.get(operation) === shownAs);
      expect(
        shared,
        `SHARES_OPERATION says "${command}" shows as "${shownAs}", but they share no operation`,
      ).not.toEqual([]);
      expect(
        [...(called ?? [])].filter((operation) => named.get(operation) === command),
        `"${command}" now has an operation of its own — delete its SHARES_OPERATION entry`,
      ).toEqual([]);
    }
  });

  it("names only a command that calls the operation", async () => {
    const commands = new Map([
      ...(await verbOperations()),
      ...(await standaloneCommandOperations()),
    ]);
    const wrong = [...(await specCommands())]
      .filter(([operation, command]) => !commands.get(command)?.has(operation))
      .map(([operation, command]) => `${operation}: x-zitadel-cli: ${command}`);

    expect(
      wrong,
      `The spec names commands that do not run these operations: ${wrong.join("; ")}. ` +
        "Correct the command, or remove the line from the operation.",
    ).toEqual([]);
  });
});

/** Every operation the CLI reaches through `consent.unlock(client)`, read from its source. */
const unlockedOperations = async (): Promise<ReadonlySet<string>> => {
  const src = join(import.meta.dirname, "../../../src");
  const files = (await readdir(src, { recursive: true })).filter((file) => file.endsWith(".ts"));
  const called = await Promise.all(
    files.map(async (file) =>
      [...(await readFile(join(src, file), "utf8")).matchAll(/unlock\(\w+\)\s*\.(\w+)\(/g)].map(
        (match) => match[1] as string,
      ),
    ),
  );
  return new Set(called.flat());
};

describe("the spec marks what the CLI confirms as destructive", () => {
  it("marks every operation the CLI calls only with consent", async () => {
    const unmarked = [...(await unlockedOperations())].filter(
      (operation) => !(destructiveOperations as readonly string[]).includes(operation),
    );

    expect(
      unmarked,
      "Give each in api/openapi/endpoints an `x-zitadel-destructive: true` line after its x-zitadel-cli, or stop asking for consent to run it.",
    ).toEqual([]);
  });

  it("finds the operations the CLI calls with consent", async () => {
    expect((await unlockedOperations()).size).toBeGreaterThan(5);
  });
});
