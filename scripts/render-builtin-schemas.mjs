#!/usr/bin/env node
/**
 * Renders the built-in schemas the server embeds
 * (`api/openapi/endpoints/schemas/*.json`) as the documents their identifiers
 * name, so that a URL such as https://zitadel.com/schemas/v1/user-schema.json
 * can answer with the document whose `$id` it is. The hosted cloud's `schemas`
 * service (repo-root vercel.json) runs it as its build and serves the files
 * under the same path; zitadel.com answers for the namespace by forwarding that
 * path to the cloud (docs/runbooks/cloud.md#built-in-schemas):
 *
 *   node scripts/render-builtin-schemas.mjs [--base URL] [--out DIR] [--serve]
 *
 * `--serve` then serves the output on $PORT, the service's dev server under
 * `vercel dev` (`pnpm run cloud`).
 *
 * The base is the server's `schema.builtin_public_base`, an identifier
 * namespace: the server resolves these documents from its embedded copies and
 * never fetches them, so hosting them serves editors and people only. Each
 * document is rendered the way the server renders it for its own validator
 * (`domain.WriteBuiltinJSONSchema` in internal/domain/json_schema.go): `$id`
 * set to its URL under the base, every relative `$ref` resolved against that
 * URL, nothing else changed. A change to one renderer belongs in the other.
 *
 * Node rather than the server's Go: on Vercel only a Go service's build has a
 * Go toolchain, and the services build one after another in no fixed order,
 * so the server's build cannot hand the files to a static service.
 *
 * Output: `<out>/<the base's path>/<name>.json`, by default
 * `dist/cloud-schemas/schemas/v1/`, the layout the service serves them under.
 * The build fails when a document refers to one under the base that is not a
 * built-in, so an editor following a `$ref` never meets a 404.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * The namespace the built-in schemas are published under: the server's default
 * `schema.builtin_public_base` (DEFAULT_BUILTIN_SCHEMA_BASE in
 * packages/config/src/defaults.ts, which the tests hold this to). The hosted
 * cloud serves the files at its path.
 */
export const HOSTED_BASE = "https://zitadel.com/schemas/v1";

/** The built-in schemas the server embeds, generated from the OpenAPI YAML. */
export const SOURCE_DIR = join(ROOT, "apps/api/api/openapi/endpoints/schemas");

/** The `schemas` service's output directory (vercel.json). */
export const DEFAULT_OUT_DIR = join(ROOT, "dist/cloud-schemas");

// What the server's isRelativeRef treats as absolute (absoluteScheme).
const ABSOLUTE_HTTP = /^https?:\/\//;

/**
 * Returns `base` without its trailing slash, after checking it can be a
 * namespace that is served: an absolute http(s) URL with a host, and neither
 * query nor fragment, which a document's URL could not carry on.
 */
export function normalizeBase(base) {
  const trimmed = base.replace(/\/+$/, "");
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`base ${JSON.stringify(base)} is not an absolute URL`);
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.host) {
    throw new Error(`base ${JSON.stringify(base)} must be an http(s) URL with a host`);
  }
  if (url.search || url.hash) {
    throw new Error(`base ${JSON.stringify(base)} must not carry a query or a fragment`);
  }
  return trimmed;
}

/**
 * The document `source` as it is published at `url`: `$id` set to `url` (after
 * `$schema`, ahead of the rest), every relative `$ref` resolved against it.
 * A `$ref` to a fragment (`#/...`) or to an absolute http(s) URL stays as it is,
 * as on the server.
 */
export function renderBuiltinSchema(source, url) {
  const { $schema, $id: _replaced, ...rest } = source;
  const document = $schema === undefined ? { $id: url, ...rest } : { $schema, $id: url, ...rest };
  return resolveRefs(document, url);
}

function resolveRefs(node, base) {
  if (Array.isArray(node)) {
    return node.map((item) => resolveRefs(item, base));
  }
  if (node === null || typeof node !== "object") {
    return node;
  }
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [
      key,
      key === "$ref" && typeof value === "string" && isRelativeRef(value)
        ? new URL(value, base).href
        : resolveRefs(value, base),
    ]),
  );
}

function isRelativeRef(ref) {
  return ref !== "" && !ref.startsWith("#") && !ABSOLUTE_HTTP.test(ref);
}

/** Every `$ref` value in `node` that names another document, fragment dropped. */
export function documentRefs(node, found = new Set()) {
  if (Array.isArray(node)) {
    for (const item of node) {
      documentRefs(item, found);
    }
  } else if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref" && typeof value === "string") {
        if (value !== "" && !value.startsWith("#")) {
          found.add(value.split("#")[0]);
        }
      } else {
        documentRefs(value, found);
      }
    }
  }
  return found;
}

/**
 * Renders every built-in under `base`, in name order, as a map of file name
 * to document. Throws when a document refers to one under `base` that is not
 * among them.
 */
export function renderBuiltinSchemas({ base = HOSTED_BASE, sourceDir = SOURCE_DIR } = {}) {
  const namespace = normalizeBase(base);
  const names = readdirSync(sourceDir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  if (names.length === 0) {
    throw new Error(`no built-in schemas in ${sourceDir}`);
  }

  const documents = new Map();
  for (const name of names) {
    const source = JSON.parse(readFileSync(join(sourceDir, name), "utf8"));
    documents.set(name, renderBuiltinSchema(source, `${namespace}/${name}`));
  }

  const dangling = [];
  for (const [name, document] of documents) {
    for (const ref of documentRefs(document)) {
      if (ref.startsWith(`${namespace}/`) && !documents.has(ref.slice(namespace.length + 1))) {
        dangling.push(`${name}: ${ref}`);
      }
    }
  }
  if (dangling.length > 0) {
    throw new Error(
      `these $refs name documents under ${namespace}/ that are not built-in schemas:\n  ${dangling.join("\n  ")}`,
    );
  }
  return documents;
}

/**
 * Writes `documents` to `<outDir>/<the base's path>/` and returns that
 * directory. A `.json` file there that is no longer a built-in is deleted;
 * nothing else is.
 */
export function writeBuiltinSchemas(
  documents,
  { base = HOSTED_BASE, outDir = DEFAULT_OUT_DIR } = {},
) {
  const segments = new URL(normalizeBase(base)).pathname.split("/").filter(Boolean);
  const dir = join(outDir, ...segments);
  mkdirSync(dir, { recursive: true });
  for (const [name, document] of documents) {
    writeFileSync(join(dir, name), `${JSON.stringify(document, null, 2)}\n`);
  }
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".json") && !documents.has(name)) {
      rmSync(join(dir, name));
    }
  }
  return dir;
}

/**
 * Serves the files under `outDir` on `port`, as a deployment serves the
 * service's output: `vercel dev` (`pnpm run cloud`) starts a dev server for
 * every service, the service's `devCommand`, and routes to it. Anything but a
 * file under `outDir` is a 404.
 */
export function serveBuiltinSchemas(outDir, port) {
  const root = resolve(outDir);
  const server = createServer((request, response) => {
    const { pathname } = new URL(request.url ?? "/", "http://localhost");
    let file = "";
    try {
      file = join(root, normalize(decodeURIComponent(pathname)));
    } catch {
      // A malformed escape names no file.
    }
    if (!file.startsWith(`${root}${sep}`) || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404, { "content-type": "text/plain" }).end("Not Found\n");
      return;
    }
    response.writeHead(200, { "content-type": "application/json" }).end(readFileSync(file));
  });
  server.listen(port);
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      base: { type: "string", default: HOSTED_BASE },
      out: { type: "string", default: DEFAULT_OUT_DIR },
      serve: { type: "boolean", default: false },
    },
  });
  const base = normalizeBase(values.base);
  const outDir = resolve(values.out);
  const documents = renderBuiltinSchemas({ base });
  const dir = writeBuiltinSchemas(documents, { base, outDir });
  const shown = relative(process.cwd(), dir);
  console.log(
    `rendered ${documents.size} built-in schemas as ${base}/<name> into ${shown.startsWith("..") ? dir : shown}`,
  );
  if (values.serve) {
    if (!process.env.PORT) {
      throw new Error("--serve listens on $PORT, which vercel dev sets");
    }
    serveBuiltinSchemas(outDir, Number(process.env.PORT));
    console.log(`serving ${outDir} on port ${process.env.PORT}`);
  }
}
