// Writes every operation's TypeScript sample, built from its default request,
// into .generated/sdk-samples/, a module each, which tsconfig.samples.json
// compiles against @zitadel/api in `typecheck`: a sample that calls a method
// the client lacks, or passes it the wrong arguments, fails the check before a
// reader copies it.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { HttpMethods, OperationObject, PathItemObject } from "fumadocs-openapi";

import bundled from "../.generated/openapi.mjs";
import { defaultRequest, withRefValues } from "../lib/default-request.ts";
import { clientMethod, sdkSample, securitySchemes } from "../lib/sdk-sample.ts";

const outputDir = resolve(dirname(fileURLToPath(import.meta.url)), "../.generated/sdk-samples");
const methods: HttpMethods[] = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
];

const document = withRefValues(bundled);

// lib/sdk-sample.ts picks the credential from an operation's own security and
// knows the spec's schemes by name; a new scheme or a default for every
// operation needs teaching it first.
if (document.security?.length) {
  throw new Error(
    "the spec sets a default security requirement, which lib/sdk-sample.ts does not read",
  );
}
const declared = Object.keys(document.components?.securitySchemes ?? {}).sort();
if (declared.join() !== [...securitySchemes].sort().join()) {
  throw new Error(
    `the spec declares the security schemes ${declared.join(", ")}; lib/sdk-sample.ts knows ${securitySchemes.join(", ")}`,
  );
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

let count = 0;
for (const [path, item] of Object.entries(document.paths ?? {})) {
  const pathItem = item as PathItemObject;
  for (const method of methods) {
    const operation = pathItem[method] as OperationObject | undefined;
    if (!operation) continue;
    const name = clientMethod(operation.operationId ?? `${method} ${path}`);
    const request = defaultRequest(operation, pathItem, method);
    const sample = sdkSample(operation, path, pathItem, request);
    await writeFile(
      resolve(outputDir, `${name}.ts`),
      `// ${method.toUpperCase()} ${path}\n${sample}\n`,
    );
    count++;
  }
}

console.log(`wrote ${count} TypeScript samples to ${outputDir}`);
