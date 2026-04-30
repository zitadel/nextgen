import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { collectTextKeys, flowDefinitionSchema } from "../../src/resources/flow";
import { mkdir, writeFile } from "node:fs/promises";
import { parseJson, runCliForTest } from "../helpers/run-cli";

describe("flow definition schema", () => {
  it("setup emits a FlowDefinition that parses against the zod schema", async () => {
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

    const result = await runCliForTest([
      "setup",
      "--cwd",
      cwd,
      "--non-interactive",
      "--json",
      "--mock",
      "--skip-deploy-platform",
      "--no-apply",
    ]);
    expect(result.exitCode).toBe(0);

    const flowPath = join(cwd, ".zitadel/flows/default.json");
    const raw = JSON.parse(await readFile(flowPath, "utf8")) as unknown;
    const parsed = flowDefinitionSchema.safeParse(raw);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
    if (!parsed.success) return;

    const flow = parsed.data;
    expect(flow.template_name).toBe("default");
    expect(flow.purposes).toContain("login");
    expect(flow.purposes).toContain("register");

    const identifier = flow.steps.find((s) => s.name === "identifier");
    expect(identifier).toBeDefined();
    if (!identifier) return;

    // fields/actions/gates are objects, not arrays
    expect(Array.isArray(identifier.fields)).toBe(false);
    expect(typeof identifier.fields).toBe("object");
    expect(identifier.fields.email).toBeDefined();
    expect(identifier.fields.email.text_key).toBe("identifier.field.email");
    expect(identifier.actions.submit.primary).toBe(true);
    expect(identifier.actions.submit.text_key).toBe("identifier.action.submit");

    // every field must have a text_key
    for (const step of flow.steps) {
      for (const [name, field] of Object.entries(step.fields)) {
        expect(field.text_key, `field ${step.name}.${name} missing text_key`).toMatch(
          /^[a-z][a-z0-9_.]+$/,
        );
      }
    }

    // collectTextKeys returns sorted keys present in the flow
    const keys = collectTextKeys(flow);
    expect(keys).toContain("identifier.title");
    expect(keys).toContain("identifier.field.email");
    expect(keys).toContain("identifier.action.submit");
  });

  it("rejects flow definitions with array-shaped fields (legacy)", () => {
    const legacy = {
      version: 1,
      kind: "flow-definition",
      slug: "legacy",
      name: "Legacy",
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
