import { mkdtemp, readFile } from "node:fs/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resetPlatformStore, setupPlatformHandlers } from "@zitadel-nextgen/api-mock/platform";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { collectTextKeys, flowDefinitionSchema } from "../../src/lib/flows";
import { runCliForTest } from "../helpers/run-cli";

const MOCK_SERVER_URL = "http://mock.zitadel.test";
const server = setupServer(...setupPlatformHandlers());
beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
afterAll(() => server.close());
afterEach(() => { server.resetHandlers(); resetPlatformStore(); });

function cli(args: string[]) {
  return runCliForTest(["--server", MOCK_SERVER_URL, ...args]);
}

async function scaffoldProject(authMethod?: "passkey" | "password"): Promise<string> {
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
  const args = [
    "setup",
    "--cwd",
    cwd,
    "--non-interactive",
    "--json",
    "--skip-deploy-platform",
    "--no-apply",
  ];
  if (authMethod) {
    args.push("--auth-method", authMethod);
  }
  const result = await cli(args);
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
    // Spec: `name` is the slug-pattern stable identifier — there is no
    // separate `slug` or `template_name`.
    expect(flow.name).toBe("default");
    expect(flow.user_schema).toMatch(/^https?:\/\//);
    expect(flow.purposes).toContain("login");
    expect(flow.purposes).toContain("register");

    const identifier = flow.steps.find((s) => s.name === "identifier");
    expect(identifier).toBeDefined();
    if (!identifier) return;

    expect(Array.isArray(identifier.fields)).toBe(false);
    expect(typeof identifier.fields).toBe("object");
    const emailField = identifier.fields.email;
    expect(emailField).toBeDefined();
    if (!emailField) return;
    expect(emailField.text_key).toBe("identifier.field.email");
    const submitAction = identifier.actions.submit;
    expect(submitAction).toBeDefined();
    if (!submitAction) return;
    expect(submitAction.primary).toBe(true);
    expect(submitAction.text_key).toBe("identifier.action.submit");

    for (const step of flow.steps) {
      for (const [name, field] of Object.entries(step.fields)) {
        expect(field.text_key, `field ${step.name}.${name} missing text_key`).toMatch(
          /^[a-z][a-z0-9_.]+$/,
        );
      }
    }

    const keys = collectTextKeys(flow);
    expect(keys).toContain("identifier.title");
    expect(keys).toContain("identifier.field.email");
    expect(keys).toContain("identifier.action.submit");
  });

  it("emits a passkey-shaped credential step when --auth-method=passkey", async () => {
    const cwd = await scaffoldProject("passkey");
    const flowPath = join(cwd, ".zitadel/flows/default.json");
    const raw = JSON.parse(await readFile(flowPath, "utf8")) as unknown;
    const parsed = flowDefinitionSchema.safeParse(raw);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
    if (!parsed.success) return;
    const credential = parsed.data.steps.find((step) => step.name === "credential");
    expect(credential?.fields).toEqual({});
    expect(credential?.actions.forgot).toBeUndefined();
    expect(credential?.transitions).toEqual({ submit: "complete" });

    const userSchema = JSON.parse(
      await readFile(join(cwd, ".zitadel/schemas/user.json"), "utf8"),
    ) as { "x-auth-methods": Record<string, unknown> };
    expect(Object.keys(userSchema["x-auth-methods"])).toEqual(["passkey"]);
  });

  it("emits a password-shaped credential step when --auth-method=password", async () => {
    const cwd = await scaffoldProject("password");
    const flowPath = join(cwd, ".zitadel/flows/default.json");
    const raw = JSON.parse(await readFile(flowPath, "utf8")) as unknown;
    const parsed = flowDefinitionSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const credential = parsed.data.steps.find((step) => step.name === "credential");
    expect(credential?.fields.password?.type).toBe("password");
    expect(credential?.actions.forgot?.text_key).toBe("credential.action.forgot");

    const userSchema = JSON.parse(
      await readFile(join(cwd, ".zitadel/schemas/user.json"), "utf8"),
    ) as { "x-auth-methods": Record<string, unknown> };
    expect(Object.keys(userSchema["x-auth-methods"])).toEqual(["password"]);
  });

  it("rejects flow definitions with array-shaped fields (legacy)", () => {
    const legacy = {
      name: "legacy",
      user_schema: "https://example.com/user.yaml",
      purposes: ["login"],
      initial_steps: { login: "identifier" },
      steps: [
        {
          name: "identifier",
          type: "identifier",
          fields: [{ name: "email", type: "email" }],
          actions: [],
        },
      ],
    };
    const parsed = flowDefinitionSchema.safeParse(legacy);
    expect(parsed.success).toBe(false);
  });
});
