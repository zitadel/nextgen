import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { startLocalZitadel } from "../../src/index";
import { fakeCliBin } from "./helpers/fake-cli";

// The fake CLI never binds ports, so a fixed port keeps msw handlers exact.
const PORT = 18095;
const BASE = `http://localhost:${PORT}`;

const okHandlers = [
  http.post(`${BASE}/projects`, () =>
    HttpResponse.json(
      { id: "proj_1", projectSecret: "secret_1", previewSecret: "preview_1" },
      { status: 201 },
    ),
  ),
  http.post(`${BASE}/schemas`, () => HttpResponse.json({ id: "sch_1" }, { status: 201 })),
  http.post(`${BASE}/flow_definitions`, () =>
    HttpResponse.json({ id: "flowdef_1" }, { status: 201 }),
  ),
];

const server = setupServer(...okHandlers);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const failProjects = () =>
  server.use(
    http.post(`${BASE}/projects`, () =>
      HttpResponse.json({ code: "req.invalid", message: "nope" }, { status: 400 }),
    ),
  );

describe("startLocalZitadel", () => {
  it("returns a connected, disposable instance on success", async () => {
    const fake = await fakeCliBin();
    const zitadel = await startLocalZitadel({ cliBin: fake.binPath, port: PORT });

    expect(zitadel.handle).toMatchObject({
      baseUrl: BASE,
      projectId: "proj_1",
      projectSecret: "secret_1",
      schemaId: "sch_1",
    });
    expect(typeof zitadel[Symbol.asyncDispose]).toBe("function");

    await zitadel[Symbol.asyncDispose]();

    const calls = await fake.calls();
    expect(calls.filter((args) => args[0] === "stop")).toHaveLength(1);
  });

  it("stops the booted instance when bootstrap fails", async () => {
    failProjects();
    const fake = await fakeCliBin();

    await expect(startLocalZitadel({ cliBin: fake.binPath, port: PORT })).rejects.toMatchObject({
      status: 400,
    });

    const calls = await fake.calls();
    expect(calls.filter((args) => args[0] === "stop")).toHaveLength(1);
  });

  it("aggregates the bootstrap error with a cleanup failure", async () => {
    failProjects();
    const fake = await fakeCliBin({ stopExitCode: 1 });

    let error: unknown;
    try {
      await startLocalZitadel({ cliBin: fake.binPath, port: PORT });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(AggregateError);
    const aggregate = error as AggregateError;
    expect(aggregate.errors).toHaveLength(2);
    expect(aggregate.errors[0]).toMatchObject({ status: 400 });
    expect((aggregate.errors[1] as Error).message).toMatch(/zitadel stop exited with code 1/);
  });
});
