import { realpath } from "node:fs/promises";

import { snapshotPlatformStore } from "@zitadel/api-mock/platform";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { anApp, NOTHING_TO_RECONCILE } from "../helpers/project";

const server = usePlatformMock();

describe("setup", () => {
  it("scaffolds the project, registers it, and leaves nothing to reconcile", async () => {
    const app = await anApp();

    const result = await app.setup([], { install: true });

    expect(result.exitCode).toBe(0);
    const { data } = app.envelopeOf<{ files_written: string[] }>(result);
    expect(app.envelopeOf(result).status).toBe("ok");
    expect(data.files_written).toContain(".zitadel/schemas/default-human-user.json");
    expect(data.files_written).toContain(".zitadel/flows/default-login.json");
    expect(new Set(data.files_written).size).toBe(data.files_written.length);
    expect(data.files_written).not.toContain(".zitadel");

    expect(await app.installInvocation()).toEqual({
      cwd: await realpath(app.path),
      args: ["install"],
    });

    expect(snapshotPlatformStore()).toMatchObject({ projects: 1, schemas: 1, flowDefinitions: 1 });
    expect(await app.plan()).toMatchObject(NOTHING_TO_RECONCILE);
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

    expect(result.exitCode).toBe(3);
    const envelope = app.envelopeOf(result);
    expect(envelope.status).toBe("error");
    expect(envelope.code).toBe("E_UNSUPPORTED_PROJECT_SHAPE");
    expect(envelope.message).toContain("below the supported floor");
    expect(await app.hasProjectFile("zitadel.json")).toBe(false);
  });

  it("skips a rerun without rewriting config the developer has edited", async () => {
    const app = await anApp();
    await app.setup();
    const editedFlow = `${await app.readProjectFile(".zitadel/flows/default-login.json")}\n`;
    const editedSchema = `${await app.readProjectFile(".zitadel/schemas/default-human-user.json")}\n`;
    await app.writeProjectFile(".zitadel/flows/default-login.json", editedFlow);
    await app.writeProjectFile(".zitadel/schemas/default-human-user.json", editedSchema);

    const rerun = await app.setup();

    expect(rerun.exitCode).toBe(0);
    expect(app.envelopeOf(rerun).status).toBe("skipped");
    expect(await app.readProjectFile(".zitadel/flows/default-login.json")).toBe(editedFlow);
    expect(await app.readProjectFile(".zitadel/schemas/default-human-user.json")).toBe(
      editedSchema,
    );
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
    expect(app.envelopeOf(failed).status).toBe("error");
    // The skip marker has to be released, or every rerun reports "skipped"
    // and the project is stranded without a login flow.
    expect(await app.hasProjectFile("zitadel.json")).toBe(false);

    server.resetHandlers();
    const retry = await app.setup(["--force"]);

    expect(retry.exitCode).toBe(0);
    const { resources } = await app.syncState();
    expect(resources[".zitadel/schemas/default-human-user.json"]?.id).toMatch(/^sch_/);
    expect(resources[".zitadel/flows/default-login.json"]?.id).toMatch(/^flowdef_/);
  });

  it.each([
    { preset: "passkey-first", entersOn: "passkey-first", method: "passkey" },
    { preset: "password-first", entersOn: "identifier", method: "password" },
  ])("scaffolds the $preset journey and records the choice", async ({ preset, entersOn, method }) => {
    const app = await anApp();

    const result = await app.setup(["--preset", preset]);
    expect(result.exitCode, result.stderr).toBe(0);

    const flow = await app.loginFlow();
    expect(flow).toMatchObject({ purposes: { login: entersOn, register: "register" } });

    const schema = await app.userSchema();
    expect(schema["x-auth-methods"]).toMatchObject({ [method]: { enabled: true } });

    const config = JSON.parse(await app.readProjectFile("zitadel.json")) as { preset?: string };
    expect(config.preset).toBe(preset);

    expect(await app.plan()).toMatchObject(NOTHING_TO_RECONCILE);
  });

  it.each([
    { useCase: "business", wiresOverlay: true },
    { useCase: "minimal", wiresOverlay: false },
  ])("wires the $useCase copy overlay into the pages", async ({ useCase, wiresOverlay }) => {
    const app = await anApp();

    const result = await app.setup(["--use-case", useCase]);
    expect(result.exitCode, result.stderr).toBe(0);

    for (const page of ["app/login/page.tsx", "app/register/page.tsx"]) {
      const source = await app.readProjectFile(page);
      expect(source.includes("element.locales = businessLocales")).toBe(wiresOverlay);
    }

    const config = JSON.parse(await app.readProjectFile("zitadel.json")) as { useCase?: string };
    expect(config.useCase).toBe(useCase);
  });
});
