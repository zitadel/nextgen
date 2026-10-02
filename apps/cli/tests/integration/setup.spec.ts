import { realpath } from "node:fs/promises";

import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { anApp } from "../helpers/project";

const server = usePlatformMock();

describe("setup", () => {
  it("scaffolds the project, registers it, and leaves nothing to reconcile", async () => {
    const app = await anApp();

    const result = await app.setup([], { install: true });

    expect(result).toSucceed();
    const { data } = app.envelopeOf<{ files_written: string[] }>(result);
    expect(data.files_written).toContain(".zitadel/schemas/default-human-user.json");
    expect(data.files_written).toContain(".zitadel/flows/default-login.json");
    expect(new Set(data.files_written).size).toBe(data.files_written.length);
    expect(data.files_written).not.toContain(".zitadel");

    expect(await app.installInvocation()).toEqual({
      cwd: await realpath(app.path),
      args: ["install"],
    });

    expect(await app.publishedSchemas()).toHaveLength(1);
    expect(await app.publishedFlows()).toHaveLength(1);
    expect(await app.plan()).toReportNothingToDo();
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
    expect(await app.hasProjectFile("zitadel.json")).toBe(false);
  });

  it("skips a rerun without rewriting config the developer has edited", async () => {
    const app = await anApp();
    await app.setup();
    const flow = `${await app.readProjectFile(".zitadel/flows/default-login.json")}\n`;
    const schema = `${await app.readProjectFile(".zitadel/schemas/default-human-user.json")}\n`;
    await app.writeProjectFile(".zitadel/flows/default-login.json", flow);
    await app.writeProjectFile(".zitadel/schemas/default-human-user.json", schema);

    expect(await app.setup()).toBeSkipped();

    expect(await app.readProjectFile(".zitadel/flows/default-login.json")).toBe(flow);
    expect(await app.readProjectFile(".zitadel/schemas/default-human-user.json")).toBe(schema);
  });

  it("lets a rerun finish what a failed run started", async () => {
    const app = await anApp();
    server.use(
      http.post("*/schemas", () =>
        HttpResponse.json({ code: "internal", message: "boom" }, { status: 500 }),
      ),
    );

    const failed = await app.setup();
    expect(failed.exitCode).not.toBe(0);
    expect(await app.hasProjectFile("zitadel.json")).toBe(false);

    server.resetHandlers();

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
