import * as endpoints from "@zitadel/api/generated/endpoints/zitadelNextGen";
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
  healthz: "liveness probe, not a resource",
  livez: "liveness probe, not a resource",
  readyz: "readiness probe, not a resource",
  flow: "the runtime login flow protocol, driven by the login UI and the SDKs",
  auth_attempts: "the runtime authentication protocol, driven by the login UI and the SDKs",
  // Variables are a management resource (ADR 062), not file-authored: only the
  // `${{ NAME }}` placeholders live in `.zitadel/`. They are excluded because
  // they do not fit this surface's grammar, not because they are configuration.
  // A variable has no id, the list returns a map keyed by name rather than
  // rows, and the write is one RFC 7386 merge over the whole map where `null`
  // removes. That is an upsert on a collection, so it would need a `set` verb
  // and map rendering, which no other resource has. `gh` models them the same
  // way, with `gh variable set` rather than create and update.
  variables: "a management resource, but keyed by name with a merge write; needs a shape decision",
};

/**
 * Operations of a covered collection that the resource commands deliberately
 * do not call, and why. Anything absent from both this list and the registry
 * is drift.
 */
const NOT_CALLED: Readonly<Record<string, string>> = {
  // Bootstrap and the claim flow belong to their own commands.
  createProject: "unauthenticated bootstrap minting secrets into .zitadel/secret; `zitadel setup` owns it",
  initClaim: "the browser claim flow; `zitadel claim` calls it",
  getClaimStatus: "the browser claim flow; `zitadel claim` calls it",
  // These two are reached by nothing in the CLI at all — not the registry, not
  // `zitadel claim`. Either the claim flow is incomplete or they are dead
  // generated surface; recorded as a question rather than implied to be owned.
  completeClaim: "part of the claim flow, but currently called by no command — unresolved",
  getClaimWindow: "part of the claim flow, but currently called by no command — unresolved",

  // Configuration is written declaratively (ADR 035), never imperatively here.
  createSchema: "configuration is written from .zitadel/ by the declarative path (deploy, ADR 035)",
  createBranding: "configuration is written from .zitadel/ by the declarative path (deploy, ADR 035)",
  createPolicy: "configuration is written from .zitadel/ by the declarative path (deploy, ADR 035)",
  createRelease: "a release is constructed by `zitadel deploy` (ADR 035)",
  createFlowDefinition: "configuration is written from .zitadel/ by the declarative path (deploy, ADR 035)",

  // End-user self-service, authenticated as that user. The CLI holds an
  // operator credential (ADR 036), so these are not its to call.
  getMyUser: "the end user's own view of themselves, on their own credential",
  patchMyUser: "the end user's own view of themselves, on their own credential",
  getMySession: "the end user's own session, on their own credential",
  listMyProjects: "the projects the signed-in user can act on, read on their own credential",
  revokeMySession: "the end user's own session, on their own credential",

  // Session and passkey protocol, driven by the SDKs and the login flow.
  createSession: "a session is minted for an end user by the SDKs and the login flow",
  exchangeHandoff: "part of the login handoff protocol",
  beginUserPasskeyRegistration: "WebAuthn registration needs an authenticator, which a terminal is not",
  finishUserPasskeyRegistration: "WebAuthn registration needs an authenticator, which a terminal is not",

  // Per-environment variables and secrets (ADR 062) are configuration: they
  // are authored in `.zitadel/` and shipped through a release, so the CLI does
  // not write them, and there is no read worth a command that `deploy` does
  // not already cover.
  getVariables: "per-environment configuration, authored in .zitadel/ and deployed",
  getVariable: "per-environment configuration, authored in .zitadel/ and deployed",
  updateVariables: "per-environment configuration, authored in .zitadel/ and deployed",
  deleteVariable: "per-environment configuration, authored in .zitadel/ and deployed",

  // ADR 063's revision routes. The CLI has no grammar for a sub-resource
  // listing (`idps revisions <id>`) and inventing verbs for one resource is
  // what ADR 064 §4 rules out, so these wait for that shape to be decided.
  listIdpRevisions: "sub-resource listing; the CLI has no grammar for it yet (ADR 063)",
  getIdpRevisionById: "reads one revision by revision id; same shape question as above",

  // Known gaps, recorded rather than hidden. These are additive and tracked as
  // a follow-up; they are listed here so adding one is a deliberate act.
  setUserPassword: "not yet exposed — follow-up, needs a credential-safe input route (ADR 064 §12)",
  listUserTeams: "not yet exposed — follow-up, a user sub-resource listing",
  listUserPasskeys: "not yet exposed — follow-up, a user sub-resource listing",
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
const REFS = ["ID", "sch_1", "flowdef_1", "https://example.com/schema.json"] as const;

/** The client operations the registry's verbs actually invoke. */
const calledOperations = async (): Promise<ReadonlySet<string>> => {
  const called = new Set<string>();
  const client = new Proxy({} as Record<string, unknown>, {
    get: (_target, property) => {
      called.add(String(property));
      return () => Promise.resolve({});
    },
  });
  const context = { client, projectId: "proj_test" } as never;

  for (const resource of Object.values(RESOURCES)) {
    const verbs = resource as Record<string, { call?: (...args: never[]) => unknown } | undefined>;
    for (const verb of ["list", "get", "create", "update", "delete"] as const) {
      // A verb may branch on the shape of its argument — a schema is addressed
      // by revision id or by object type — so every branch is driven, or the
      // client call behind the untaken one would look unused. The recording
      // client resolves `{}`, so a call that inspects its response throws;
      // only the property that was reached matters, so the throw is discarded.
      for (const ref of REFS) {
        await verbs[verb]?.call?.(context, ref as never, {} as never).catch(() => undefined);
      }
    }
  }
  return called;
};

describe("the CLI covers the API client", () => {
  it("calls, or explains, every operation the client offers", async () => {
    const called = await calledOperations();
    const unaccounted = [...clientOperations()]
      .filter(([operation, collection]) => {
        if (called.has(operation) || operation in NOT_CALLED) {
          return false;
        }
        return !(collection in NOT_RESOURCES);
      })
      .map(([operation]) => operation);

    expect(
      unaccounted,
      `The API client offers operations the CLI neither calls nor explains: ${unaccounted.join(", ")}. ` +
        "Add or extend a registry entry in src/commands/resources.ts, or add the operation to " +
        "NOT_CALLED in this test with the reason it stays unexposed.",
    ).toEqual([]);
  });

  it("has a registry entry, or a reason, for every collection", async () => {
    const topics = new Set(Object.keys(RESOURCES).map((topic) => topic.replaceAll("-", "_")));
    const unaccounted = [...new Set(clientOperations().values())].filter(
      (collection) => !topics.has(collection) && !(collection in NOT_RESOURCES),
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
