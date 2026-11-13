import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { test } from "vitest";
import { parse } from "yaml";

// The list conventions (apps/api/api/openapi/AGENTS.md, ADR 027, ADR 031)
// relate one part of the spec to another: a list's path to its response and
// its paging inputs, a query body to its sort-field schema's name, a path
// segment to the paths below it. Redocly's configurable rules see one node at
// a time, so these checks read the bundled spec, where every $ref is local and
// names its component after the source file.

const repoFile = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));

const fixture = async (name) =>
  parse(
    await readFile(
      fileURLToPath(new URL(`./testdata/openapi-lists/${name}`, import.meta.url)),
      "utf8",
    ),
  );

const bundled = JSON.parse(
  await readFile(repoFile("apps/api/api/openapi/bundled/openapi.json"), "utf8"),
);

// Every finding the spec has today, named with its reason. A finding no entry
// names fails, and so does an entry that finds nothing, so each list shrinks
// as the API is fixed.

/** Departures to fix, each in a PR of its own: every fix changes the contract. */
const KNOWN_VIOLATIONS = {
  "list-response-shape": {
    listBranding: "returns the newest 100 revisions as a bare array, so it cannot page",
  },
  "list-pagination": {
    listBranding: "takes no `limit` or `page_token`: it returns the newest 100 revisions",
  },
  "query-sort-field": {
    queryProjects: "sorts by the shared `filter-field`",
    queryTeams: "sorts by `team-filter-field`, its filter's enum",
    queryIdps: "sorts by `idp-filter-field`, its filter's enum",
    queryGrants: "names its enum `grant-sorting-field`",
  },
  "collection-plural": {
    "/flow": "singular, though `{flow_id}` names one of many flows",
  },
};

/** Lists that return one map keyed by name, which has no page to turn. */
const MAP_LISTS = {
  listVariables: "returns the project's variables as one map keyed by name",
  listDeploymentVariables: "returns the variables a deployment froze as one map",
};

/** Departures by design. */
const EXEMPT = {
  "list-response-shape": MAP_LISTS,
  "list-pagination": MAP_LISTS,
  "collection-plural": {
    "/branding": "the project's one branding; `{branding_id}` names a revision of it",
  },
};

const isParam = (segment) => segment.startsWith("{");
const segmentsOf = (path) => path.split("/").slice(1);

/** Follows local $refs (`#/components/…`) to the node they name. */
function deref(spec, node) {
  for (let hops = 0; node?.$ref; hops++) {
    assert.ok(hops < 32 && node.$ref.startsWith("#/"), `cannot follow $ref ${node.$ref}`);
    node = node.$ref
      .slice(2)
      .split("/")
      .map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"))
      .reduce((parent, key) => parent?.[key], spec);
  }
  return node;
}

/** The component a $ref names (`user-sort-field`); undefined for an inline schema. */
const refName = (node) => node?.$ref?.split("/").at(-1);

/** `users` → `user`, `policies` → `policy`: enough English for the spec's nouns. */
const singular = (plural) => plural.replace(/ies$/, "y").replace(/s$/, "");

/**
 * The paths that name a collection, each ending in its segment: one an ID
 * follows (`/users` in `/users/{user_id}`), one that is queried
 * (`/users/query`), or one whose GET is a `list…` (`/users/{user_id}/teams`).
 * An action (`/query`, `/claim/init`), a singleton (`/users/me`,
 * `/users/{user_id}/password`) or an endpoint (`/search`, `/livez`) is none.
 */
function collections(spec) {
  const found = new Set();
  for (const [path, item] of Object.entries(spec.paths)) {
    const segments = segmentsOf(path);
    segments.forEach((segment, i) => {
      const next = segments[i + 1];
      if (isParam(segment) || next === undefined) return;
      const queried = next === "query" && i + 2 === segments.length && item.post;
      if (isParam(next) || queried) found.add(`/${segments.slice(0, i + 1).join("/")}`);
    });
    if (/^list[A-Z]/.test(item.get?.operationId ?? "")) found.add(path);
  }
  return found;
}

/**
 * Every list operation: the GET on a collection and the POST on its `/query`.
 * `resource` is the collection's segment; `inputs` maps each paging input's
 * name (query parameters of a GET, body properties of a query) to its schema.
 */
function listOperations(spec) {
  const lists = [];
  const collectionPaths = collections(spec);
  for (const [path, item] of Object.entries(spec.paths)) {
    const segments = segmentsOf(path);
    if (item.get && collectionPaths.has(path)) {
      const parameters = [...(item.parameters ?? []), ...(item.get.parameters ?? [])]
        .map((parameter) => deref(spec, parameter))
        .filter((parameter) => parameter.in === "query");
      const inputs = Object.fromEntries(parameters.map((p) => [p.name, p.schema]));
      lists.push({ op: item.get, resource: segments.at(-1), inputs });
    }
    if (item.post && segments.length > 1 && segments.at(-1) === "query") {
      const request = deref(spec, item.post.requestBody);
      const body = deref(spec, request?.content?.["application/json"]?.schema);
      lists.push({
        op: item.post,
        resource: segments.at(-2),
        inputs: body?.properties ?? {},
        body,
      });
    }
  }
  return lists;
}

/** Each check returns its findings, `{ key, message }`, keyed as the exceptions are. */
const checks = {
  /** A list returns `{ <resource>: [...], next_page_token }` and nothing else. */
  "list-response-shape"(spec) {
    return listOperations(spec).flatMap(({ op, resource }) => {
      const response = deref(spec, op.responses?.["200"]);
      const body = deref(spec, response?.content?.["application/json"]?.schema);
      const wanted = [resource, "next_page_token"].sort();
      const properties = Object.keys(body?.properties ?? {}).sort();
      let problem;
      if (!body) problem = "has no 200 application/json response";
      else if (body.type !== "object") problem = `returns type \`${body.type}\`, not an object`;
      else if (properties.join() !== wanted.join())
        problem = `returns {${properties.join(", ")}}, not {${wanted.join(", ")}}`;
      else if (deref(spec, body.properties[resource]).type !== "array")
        problem = `returns \`${resource}\` as other than an array`;
      return problem ? [{ key: op.operationId, message: problem }] : [];
    });
  },

  /** A list pages by `page_token` and a `limit` of 1 to 100, default 20 (ADR 027). */
  "list-pagination"(spec) {
    return listOperations(spec).flatMap(({ op, inputs }) => {
      const problems = ["limit", "page_token"]
        .filter((name) => !Object.hasOwn(inputs, name))
        .map((name) => `takes no \`${name}\``);
      if (Object.hasOwn(inputs, "limit")) {
        const { minimum, maximum, default: fallback } = deref(spec, inputs.limit) ?? {};
        if (minimum !== 1 || maximum !== 100 || fallback !== 20)
          problems.push(
            `bounds \`limit\` to ${minimum}..${maximum} default ${fallback}, not 1..100 default 20`,
          );
      }
      return problems.length ? [{ key: op.operationId, message: problems.join("; ") }] : [];
    });
  },

  /** A query sorts by its own `<resource>-sort-field` enum, not its filter's (ADR 031). */
  "query-sort-field"(spec) {
    return listOperations(spec).flatMap(({ op, resource, body }) => {
      const field = deref(spec, body?.properties?.sorting)?.properties?.field;
      if (!field) return [];
      // Component names are kebab-case file names: `flow_definitions` sorts by
      // `flow-definition-sort-field`.
      const wanted = `${singular(resource.replaceAll("_", "-"))}-sort-field`;
      const actual = refName(field);
      if (actual === wanted) return [];
      const named = actual ? `\`${actual}\`` : "an inline schema";
      return [{ key: op.operationId, message: `sorts by ${named}, not \`${wanted}\`` }];
    });
  },

  /** A collection's segment is a plural snake_case noun. */
  "collection-plural"(spec) {
    return [...collections(spec)].flatMap((path) => {
      const segment = path.split("/").at(-1);
      if (/^[a-z][a-z0-9]*(_[a-z0-9]+)*s$/.test(segment)) return [];
      return [
        { key: path, message: `names its collection \`${segment}\`, not a plural snake_case noun` },
      ];
    });
  },
};

test("each check reports every violation in the fixture, each once, and nothing else", async () => {
  // One violation per operation or path per check, so a check that stops
  // after its first finding, or reports one twice, fails here.
  const spec = await fixture("violations.yaml");
  const found = Object.entries(checks).flatMap(([rule, check]) =>
    check(spec).map(({ key }) => `${rule} ${key}`),
  );
  assert.deepEqual(found.sort(), [
    "collection-plural /bolts/{bolt_id}/child",
    "collection-plural /flow",
    "collection-plural /inventory",
    "collection-plural /stock",
    "collection-plural /thingGroups",
    "list-pagination listNuts",
    "list-pagination listScrews",
    "list-pagination listWashers",
    "list-pagination queryRivets",
    "list-response-shape getPins",
    "list-response-shape listBareArrays",
    "list-response-shape listBoltThreads",
    "list-response-shape listGadgets",
    "list-response-shape listGizmos",
    "list-response-shape listTools",
    "list-response-shape listWidgets",
    "list-response-shape queryParts",
    "query-sort-field queryGearWheels",
    "query-sort-field queryGears",
    "query-sort-field querySprings",
  ]);
});

test("compliant lists, singletons, actions and endpoints are left alone", async () => {
  const spec = await fixture("clean.yaml");
  // The checks only prove something if they find the fixture's lists: none
  // of the rest is a collection.
  assert.deepEqual([...collections(spec)].sort(), [
    "/categories",
    "/flow_definitions",
    "/oauth_settings",
    "/things",
    "/things/me/parts",
    "/things/revisions",
    "/things/{thing_id}/revisions",
  ]);
  assert.deepEqual(
    listOperations(spec)
      .map(({ op }) => op.operationId)
      .sort(),
    [
      "listMyParts",
      "listThingRevisions",
      "listThings",
      "queryCategories",
      "queryFlowDefinitions",
      "queryThings",
    ],
  );
  for (const [rule, check] of Object.entries(checks)) assert.deepEqual(check(spec), [], rule);
});

for (const [rule, check] of Object.entries(checks)) {
  test(`${rule}: the bundled spec's findings are exactly its named exceptions`, () => {
    const allowed = { ...KNOWN_VIOLATIONS[rule], ...EXEMPT[rule] };
    const findings = check(bundled);
    assert.deepEqual(
      findings
        .filter(({ key }) => !Object.hasOwn(allowed, key))
        .map((f) => `${f.key} ${f.message}`),
      [],
      `${rule}: follow the convention (apps/api/api/openapi/AGENTS.md), or name the departure in KNOWN_VIOLATIONS or EXEMPT with its reason`,
    );
    assert.deepEqual(
      Object.keys(allowed).filter((key) => !findings.some((f) => f.key === key)),
      [],
      `${rule}: these exceptions no longer find anything; delete them`,
    );
  });
}
