import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TestProject } from "vitest/node";

import type { InstanceHandle } from "../../src/types";
import { injectZitadel, zitadelGlobalSetup } from "../../src/vitest";
import { fakeCliBin } from "./helpers/fake-cli";

// The entry's reader goes through Vitest's own inject(); stand in for the
// worker side of provide/inject so a test can play both halves of a run.
const provided = vi.hoisted(() => new Map<string, unknown>());
vi.mock("vitest", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vitest")>()),
  inject: (key: string) => provided.get(key),
}));

// The fake CLI never binds ports, so a fixed port keeps msw handlers exact.
const PORT = 18096;
const BASE = `http://localhost:${PORT}`;

const server = setupServer(
  http.post(`${BASE}/api/v1/projects`, () =>
    HttpResponse.json(
      { id: "proj_1", project_secret: "secret_1", preview_secret: "preview_1" },
      { status: 201 },
    ),
  ),
  http.post(`${BASE}/api/v1/schemas`, () => HttpResponse.json({ id: "sch_1" }, { status: 201 })),
  http.post(`${BASE}/api/v1/flow_definitions`, () =>
    HttpResponse.json({ id: "flowdef_1" }, { status: 201 }),
  ),
  http.post(`${BASE}/api/v1/releases`, () => HttpResponse.json({ id: "rel_1" }, { status: 201 })),
  http.post(`${BASE}/api/v1/deployments`, () =>
    HttpResponse.json({ id: "dep_1" }, { status: 201 }),
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => provided.clear());

/** The slice of a TestProject the global setup touches. */
function fakeProject(): TestProject {
  return {
    provide: (key: string, value: unknown) => provided.set(key, value),
  } as unknown as TestProject;
}

describe("zitadelGlobalSetup", () => {
  it("boots one instance, provides its handle, and stops it on teardown", async () => {
    const fake = await fakeCliBin();
    const teardown = await zitadelGlobalSetup({
      cliBin: fake.binPath,
      port: PORT,
      appOrigins: ["http://localhost:3002"],
    })(fakeProject());

    // Exactly one value crosses to the workers, and it is the plain handle.
    expect(provided.size).toBe(1);
    const [handle] = [...provided.values()] as InstanceHandle[];
    expect(handle).toEqual({
      baseUrl: BASE,
      projectId: "proj_1",
      projectSecret: "secret_1",
      schemaId: "sch_1",
      previewSecret: "preview_1",
      appOrigin: "http://localhost:3002",
    });
    expect(JSON.parse(JSON.stringify(handle))).toEqual(handle);

    let calls = await fake.calls();
    expect(calls.filter((args) => args[0] === "start")).toHaveLength(1);
    expect(calls.filter((args) => args[0] === "stop")).toHaveLength(0);

    await teardown();
    calls = await fake.calls();
    expect(calls.filter((args) => args[0] === "stop")).toHaveLength(1);
  });

  it("forwards the boot options to startLocalZitadel", async () => {
    const fake = await fakeCliBin();
    const teardown = await zitadelGlobalSetup({ cliBin: fake.binPath, port: PORT })(fakeProject());
    await teardown();

    const [start] = (await fake.calls()).filter((args) => args[0] === "start");
    expect(start).toEqual(expect.arrayContaining(["--port", String(PORT)]));
  });

  it("provides nothing and leaves no instance when the boot fails", async () => {
    server.use(
      http.post(`${BASE}/api/v1/projects`, () =>
        HttpResponse.json({ code: "req.invalid", message: "nope" }, { status: 400 }),
      ),
    );
    const fake = await fakeCliBin();

    await expect(
      zitadelGlobalSetup({ cliBin: fake.binPath, port: PORT })(fakeProject()),
    ).rejects.toThrow();
    expect(provided.size).toBe(0);
    // startLocalZitadel stops the server it booted before rethrowing.
    expect((await fake.calls()).filter((args) => args[0] === "stop")).toHaveLength(1);
  });
});

describe("injectZitadel", () => {
  it("connects to the handle the global setup provided", async () => {
    const fake = await fakeCliBin();
    const teardown = await zitadelGlobalSetup({ cliBin: fake.binPath, port: PORT })(fakeProject());
    try {
      const zitadel = injectZitadel();
      expect(zitadel.handle).toEqual([...provided.values()][0]);
      expect(typeof zitadel.seedUser).toBe("function");
      expect(typeof zitadel.seedSession).toBe("function");
      expect(zitadel.identity().email).toMatch(/@/);
    } finally {
      await teardown();
    }
  });

  it("names the missing global setup when nothing was provided", () => {
    expect(() => injectZitadel()).toThrow(/zitadelGlobalSetup\(\).*test\.globalSetup/s);
  });
});
