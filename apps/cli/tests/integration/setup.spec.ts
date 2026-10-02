import { realpath } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { anApp } from "../helpers/project";

const platform = usePlatformMock();

describe("setup", () => {
  it("scaffolds the project, registers it, and leaves nothing to reconcile", async () => {
    const app = await anApp();

    const result = await app.setup([], { install: true });

    expect(result).toSucceed();
    const { data } = app.envelopeOf<{ files_written: string[] }>(result);
    expect(data.files_written).toContain(".zitadel/schemas/default-human-user.json");
    expect(data.files_written).toContain(".zitadel/flows/default-login.json");
    expect(new Set(data.files_written).size).toBe(data.files_written.length);
    expect(await app.publishedSchemas()).toHaveLength(1);
    expect(await app.publishedFlows()).toHaveLength(1);
    expect(await app.plan()).toReportNothingToDo();
  });

  it("installs the dependencies it added", async () => {
    const app = await anApp();

    const result = await app.setup([], { install: true });

    expect(result).toSucceed();
    expect(await app.installInvocation()).toEqual({
      cwd: await realpath(app.path),
      args: ["install"],
    });
  });

  it("keeps the package manager's own output off stdout", async () => {
    const app = await anApp();

    const result = await app.setup([], { install: true });

    expect(result.stdout).not.toContain("fake npm stdout");
    expect(result.stderr).toContain("fake npm stdout");
  });

  it("refuses an app below the supported framework version without touching it", async () => {
    const app = await anApp({ nextVersion: "^14.2.0" });

    const result = await app.setup();

    expect(result).toFailWith("E_UNSUPPORTED_PROJECT_SHAPE");
    expect(result).toExplain("below the supported floor");
    expect(await app.hasBeenConfigured()).toBe(false);
  });

  it("skips a rerun and leaves the developer's edits in place", async () => {
    const app = await anApp();
    expect(await app.setup()).toSucceed();
    await app.editUserSchema((schema) => {
      schema.properties.company = { type: "string" };
    });

    expect(await app.setup()).toBeSkipped();

    expect((await app.plan()).total).toBeGreaterThan(0);
  });

  it("lets a rerun finish what a failed run started", async () => {
    const app = await anApp();
    platform.rejectsSchemaUploads();
    expect(await app.setup()).toFail();
    expect(await app.hasBeenConfigured()).toBe(false);
    platform.recovers();

    expect(await app.setup(["--force"])).toSucceed();

    expect(await app.publishedSchemas()).toHaveLength(1);
    expect(await app.publishedFlows()).toHaveLength(1);
    expect(await app.plan()).toReportNothingToDo();
  });

  it.each([
    { preset: "passkey-first", entersOn: "passkey-first", method: "passkey" },
    { preset: "password-first", entersOn: "identifier", method: "password" },
  ])("scaffolds the $preset journey", async ({ preset, entersOn, method }) => {
    const app = await anApp();

    expect(await app.setup(["--preset", preset])).toSucceed();

    const { flow_definition } = await app.publishedFlow();
    expect(flow_definition.purposes).toMatchObject({ login: entersOn, register: "register" });
    const { schema } = await app.publishedSchema();
    expect(schema["x-auth-methods"]).toMatchObject({ [method]: { enabled: true } });
    expect(await app.plan()).toReportNothingToDo();
  });

  it.each([
    { useCase: "business", wiresOverlay: true },
    { useCase: "minimal", wiresOverlay: false },
  ])("wires the $useCase copy into the pages it scaffolds", async ({ useCase, wiresOverlay }) => {
    const app = await anApp();

    expect(await app.setup(["--use-case", useCase])).toSucceed();

    for (const page of ["app/login/page.tsx", "app/register/page.tsx"]) {
      const source = await app.readProjectFile(page);
      expect(source.includes("element.locales = businessLocales")).toBe(wiresOverlay);
    }
  });
});
