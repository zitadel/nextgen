import { expect, test } from "@playwright/test";
import type { OperationObject } from "fumadocs-openapi";
import type { RequestData } from "fumadocs-openapi/requests";

import { cliSample } from "../lib/cli-sample.ts";

/**
 * The CLI sample of the variable operations (lib/cli-sample.ts): a command is
 * shown only for a request it does exactly, and any other is the
 * `zitadel api` call.
 */

interface Call {
  kind?: "primary" | "preview";
  body?: unknown;
}

function sample(
  command: string,
  operationId: string,
  path: string,
  pathValues: Record<string, string>,
  { kind, body }: Call,
): string {
  const operation = {
    "x-zitadel-cli": command,
    operationId,
    requestBody: {},
  } as unknown as OperationObject;
  const request = {
    path: Object.fromEntries(Object.entries(pathValues).map(([name, value]) => [name, { value }])),
    query: kind ? { kind: { values: [kind] } } : {},
    header: {},
    cookie: {},
    body,
  } as unknown as RequestData;
  return cliSample(operation, path, {}, request) ?? "";
}

function set(call: Call): string {
  return sample("variable set", "updateVariables", "/variables", {}, call);
}

function get(call: Call): string {
  return sample("variable get", "getVariable", "/variables/{name}", { name: "A" }, call);
}

function list(call: Call): string {
  return sample("variable list", "getVariables", "/variables", {}, call);
}

function rm(call: Call): string {
  return sample("variable rm", "deleteVariable", "/variables/{name}", { name: "A" }, call);
}

function resolve(): string {
  return sample(
    "variable resolve",
    "getDeploymentVariables",
    "/deployments/{deployment_id}/variables",
    { deployment_id: "dep_1" },
    {},
  );
}

const secret = { A: { secret: true, value: "x" } };

const commands: [string, () => string, string][] = [
  ["a set without a kind", () => set({ body: { A: "1" } }), "variable set A"],
  ["a typed set", () => set({ body: { N: 3 } }), "variable set N --as number"],
  ["a secret set", () => set({ body: secret }), "variable set A --secret"],
  [
    "a secret set of the preview value",
    () => set({ kind: "preview", body: secret }),
    "variable set A --secret --preview",
  ],
  ["a get of the primary value", () => get({ kind: "primary" }), "variable get A"],
  ["a get of the preview value", () => get({ kind: "preview" }), "variable get A --preview"],
  ["an unfiltered list", () => list({}), "variable list"],
  ["a list of the preview values", () => list({ kind: "preview" }), "variable list --preview"],
  ["a removal without a kind", () => rm({}), "variable rm A"],
  ["a removal of the preview value", () => rm({ kind: "preview" }), "variable rm A --preview"],
];

for (const [what, run, expected] of commands) {
  test(`${what} is the variable command`, () => {
    const text = run();
    expect(text).toContain(`npx @zitadel/cli@latest ${expected}`);
    expect(text).not.toContain("npx @zitadel/cli@latest api");
    expect(text).not.toContain("variables ");
    expect(text).not.toContain("--project-level");
  });
}

const calls: [string, () => string, string][] = [
  [
    "a plain write of the preview value",
    () => set({ kind: "preview", body: { A: "1" } }),
    "api updateVariables",
  ],
  ["a primary-only write", () => set({ kind: "primary", body: { A: "1" } }), "api updateVariables"],
  ["a primary-only removal", () => rm({ kind: "primary" }), "api deleteVariable A"],
  ["a get that names no kind", () => get({}), "api getVariable A"],
  ["a primary-only list", () => list({ kind: "primary" }), "api getVariables"],
  [
    "a body that sets several variables",
    () => set({ body: { A: "1", B: "2" } }),
    "api updateVariables",
  ],
  ["a body that removes a variable", () => set({ body: { A: null } }), "api updateVariables"],
  [
    "a secret that is not a string",
    () => set({ body: { A: { secret: true, value: 3 } } }),
    "api updateVariables",
  ],
  ["a deployment's variables", resolve, "api getDeploymentVariables dep_1"],
];

for (const [what, run, expected] of calls) {
  test(`${what} is the zitadel api call`, () => {
    const text = run();
    expect(text).toContain(`npx @zitadel/cli@latest ${expected}`);
    expect(text).not.toContain("npx @zitadel/cli@latest variable ");
  });
}

test("a variables body is piped as JSON, whatever its keys and values", () => {
  const body = { kind: "x", NOTE: "a\nb", N: 3 };
  const text = set({ kind: "primary", body });
  expect(text).toContain(`printf '%s' '${JSON.stringify(body)}' | npx @zitadel/cli@latest api`);
  expect(text).toContain("--input -");
  expect(text).toContain("-F kind=primary");
  expect(text).not.toContain("-F kind=x");
  expect(text).not.toContain("echo");
});
