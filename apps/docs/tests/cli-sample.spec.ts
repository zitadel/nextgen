import { expect, test } from "@playwright/test";
import type { OperationObject } from "fumadocs-openapi";
import type { RequestData } from "fumadocs-openapi/requests";

import { cliSample } from "../lib/cli-sample.ts";

/**
 * The CLI sample of the variable operations (lib/cli-sample.ts): a command is
 * shown only for a request it does exactly, and any other is the
 * `zitadel api` call.
 */

type Kind = "primary" | "preview" | undefined;

function sample(
  command: string,
  operationId: string,
  options: { kind?: Kind; path?: string; pathValues?: Record<string, string>; body?: unknown },
): string {
  const operation = {
    "x-zitadel-cli": command,
    operationId,
    requestBody: {},
  } as unknown as OperationObject;
  const request = {
    path: Object.fromEntries(
      Object.entries(options.pathValues ?? {}).map(([name, value]) => [name, { value }]),
    ),
    query: options.kind ? { kind: { values: [options.kind] } } : {},
    header: {},
    cookie: {},
    body: options.body,
  } as unknown as RequestData;
  return cliSample(operation, options.path ?? "/variables", {}, request) ?? "";
}

const name = { path: "/variables/{name}", pathValues: { name: "A" } };

const commands: [string, () => string, string][] = [
  [
    "a single set without a kind",
    () => sample("variable set", "updateVariables", { body: { A: "1" } }),
    "variable set A",
  ],
  [
    "a secret set of the preview value",
    () =>
      sample("variable set", "updateVariables", {
        kind: "preview",
        body: { A: { secret: true, value: "x" } },
      }),
    "variable set A --secret --preview",
  ],
  [
    "a typed set",
    () => sample("variable set", "updateVariables", { body: { N: 3 } }),
    "variable set N --as number",
  ],
  [
    "a secret set",
    () => sample("variable set", "updateVariables", { body: { A: { secret: true, value: "x" } } }),
    "variable set A --secret",
  ],
  [
    "a get of the primary value",
    () => sample("variable get", "getVariable", { ...name, kind: "primary" }),
    "variable get A",
  ],
  [
    "a get of the preview value",
    () => sample("variable get", "getVariable", { ...name, kind: "preview" }),
    "variable get A --preview",
  ],
  ["an unfiltered list", () => sample("variable list", "getVariables", {}), "variable list"],
  [
    "a list of the preview values",
    () => sample("variable list", "getVariables", { kind: "preview" }),
    "variable list --preview",
  ],
  [
    "a removal without a kind",
    () => sample("variable rm", "deleteVariable", name),
    "variable rm A",
  ],
  [
    "a removal of the preview value",
    () => sample("variable rm", "deleteVariable", { ...name, kind: "preview" }),
    "variable rm A --preview",
  ],
];

for (const [what, run, expected] of commands) {
  test(`${what} is the variable command`, () => {
    const sampleText = run();
    expect(sampleText).toContain(`npx @zitadel/cli@latest ${expected}`);
    expect(sampleText).not.toContain("npx @zitadel/cli@latest api");
    expect(sampleText).not.toContain("variables ");
    expect(sampleText).not.toContain("--project-level");
  });
}

const calls: [string, () => string, string][] = [
  [
    "a plain write of the preview value",
    () => sample("variable set", "updateVariables", { kind: "preview", body: { A: "1" } }),
    "api updateVariables",
  ],
  [
    "a primary-only write",
    () => sample("variable set", "updateVariables", { kind: "primary", body: { A: "1" } }),
    "api updateVariables",
  ],
  [
    "a primary-only removal",
    () => sample("variable rm", "deleteVariable", { ...name, kind: "primary" }),
    "api deleteVariable A",
  ],
  [
    "a get that names no kind",
    () => sample("variable get", "getVariable", name),
    "api getVariable A",
  ],
  [
    "a primary-only list",
    () => sample("variable list", "getVariables", { kind: "primary" }),
    "api getVariables",
  ],
  [
    "a body that sets several variables",
    () => sample("variable set", "updateVariables", { body: { A: "1", B: "2" } }),
    "api updateVariables",
  ],
  [
    "a body that removes a variable",
    () => sample("variable set", "updateVariables", { body: { A: null } }),
    "api updateVariables",
  ],
  [
    "a secret that is not a string",
    () => sample("variable set", "updateVariables", { body: { A: { secret: true, value: 3 } } }),
    "api updateVariables",
  ],
  [
    "a deployment's variables",
    () =>
      sample("variable resolve", "getDeploymentVariables", {
        path: "/deployments/{deployment_id}/variables",
        pathValues: { deployment_id: "dep_1" },
      }),
    "api getDeploymentVariables dep_1",
  ],
];

for (const [what, run, expected] of calls) {
  test(`${what} is the zitadel api call`, () => {
    const sampleText = run();
    expect(sampleText).toContain(`npx @zitadel/cli@latest ${expected}`);
    expect(sampleText).not.toContain("npx @zitadel/cli@latest variable ");
  });
}

test("a variables body is piped as JSON, whatever its keys and values", () => {
  const body = { kind: "x", NOTE: "a\nb", N: 3 };
  const text = sample("variable set", "updateVariables", { kind: "primary", body });
  expect(text).toContain(`printf '%s' '${JSON.stringify(body)}' | npx @zitadel/cli@latest api`);
  expect(text).toContain("--input -");
  expect(text).toContain("-F kind=primary");
  expect(text).not.toContain("-F kind=x");
  expect(text).not.toContain("echo");
});
