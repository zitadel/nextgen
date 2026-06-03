import { mkdtemp, readFile } from "node:fs/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resetPlatformStore, setupPlatformHandlers } from "@zitadel/api-mock/platform";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { CreateFlowDefinitionBody } from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";

/** The inner flow-definition shape; the envelope is `CreateFlowDefinitionBody`. */
const flowDefinitionSchema = CreateFlowDefinitionBody.shape.flow_definition;
import { runCliForTest } from "../helpers/run-cli";

const MOCK_SERVER_URL = "http://mock.zitadel.test";
const server = setupServer(...setupPlatformHandlers());
beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
afterAll(() => server.close());
afterEach(() => { server.resetHandlers(); resetPlatformStore(); });

function cli(args: string[]) {
  return runCliForTest([...args, "--server", MOCK_SERVER_URL]);
}

async function scaffoldProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-flow-schema-"));
  await mkdir(join(cwd, "app"), { recursive: true });
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ name: "demo", private: true, dependencies: { next: "^15" } }, null, 2),
  );
  await writeFile(
    join(cwd, "app/layout.tsx"),
    "export default function Layout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }\n",
  );
  const result = await cli([
    "setup",
    "--cwd",
    cwd,
    "--non-interactive",
    "--json",
    "--no-apply",
  ]);
  if (result.exitCode !== 0) {
    throw new Error(`setup failed: ${result.stdout}`);
  }
  return cwd;
}

describe("flow definition schema", () => {
  it("setup emits a FlowDefinition that parses against the zod schema", async () => {
    const cwd = await scaffoldProject();

    const flowPath = join(cwd, ".zitadel/flows/default.json");
    const raw = JSON.parse(await readFile(flowPath, "utf8")) as unknown;
    const parsed = flowDefinitionSchema.safeParse(raw);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
    if (!parsed.success) return;

    const flow = parsed.data;
    expect(flow.name).toBe("default");
    expect(flow.user_schema).toMatch(/^https?:\/\//);
    expect(Object.keys(flow.purposes)).toEqual(expect.arrayContaining(["login", "register"]));
    expect(flow.purposes.login).toBe("identifier");
    expect(flow.purposes.register).toBe("register-profile");

    const identifier = flow.steps.find((s) => s.name === "identifier");
    expect(identifier).toBeDefined();
    if (!identifier) return;

    // Spec: step.fields is a `string[]` of property names from the
    // user schema (not a rich per-field config — that lives on the
    // user schema itself).
    expect(Array.isArray(identifier.fields)).toBe(true);
    expect(identifier.fields).toContain("email");

    const submitAction = identifier.actions.submit;
    expect(submitAction).toBeDefined();
    expect(submitAction?.primary).toBe(true);
  });

  it("emits a credential step that collects the password property", async () => {
    const cwd = await scaffoldProject();
    const flowPath = join(cwd, ".zitadel/flows/default.json");
    const raw = JSON.parse(await readFile(flowPath, "utf8")) as unknown;
    const parsed = flowDefinitionSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const credential = parsed.data.steps.find((step) => step.name === "credential");
    expect(credential?.fields).toEqual(["password"]);
    expect(credential?.actions.submit?.primary).toBe(true);
    expect(credential?.transitions).toEqual({
      submit: { target: "complete" },
    });

    const userSchema = JSON.parse(
      await readFile(join(cwd, ".zitadel/schemas/user.json"), "utf8"),
    ) as { "x-auth-methods": Record<string, unknown> };
    expect(Object.keys(userSchema["x-auth-methods"])).toEqual(["password"]);
  });

  it("routes user_not_found from the identifier step to register-profile", async () => {
    const cwd = await scaffoldProject();
    const flowPath = join(cwd, ".zitadel/flows/default.json");
    const raw = JSON.parse(await readFile(flowPath, "utf8")) as unknown;
    const parsed = flowDefinitionSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const identifier = parsed.data.steps.find((step) => step.name === "identifier");
    expect(identifier?.transitions?.user_not_found).toEqual({ target: "register-profile" });
  });

  it("rejects flow definitions with object-shaped fields (spec says fields is string[])", () => {
    const legacy = {
      name: "legacy",
      user_schema: "https://example.com/user.yaml",
      purposes: { login: "identifier" },
      steps: [
        {
          name: "identifier",
          fields: { email: { type: "email" } },
          actions: {},
        },
      ],
    };
    const parsed = flowDefinitionSchema.safeParse(legacy);
    expect(parsed.success).toBe(false);
  });
});
