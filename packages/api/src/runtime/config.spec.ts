import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, test, vi } from "vitest";

import { configureZitadel, getApi, getZitadelConfig, _resetConfigForTesting } from "./config";

const servers: Server[] = [];

/** A local server that answers `{}` and records each request's `Authorization`. */
async function bearers(): Promise<{ base: string; authorizations: (string | undefined)[] }> {
  const authorizations: (string | undefined)[] = [];
  const server = createServer((req, res) => {
    authorizations.push(req.headers.authorization);
    res.setHeader("content-type", "application/json");
    res.end("{}");
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, authorizations };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done))));
  _resetConfigForTesting();
  vi.restoreAllMocks();
});

describe("configureZitadel", () => {
  test("sets config, and the project's client points at its proxy path", () => {
    const project = configureZitadel({ proxyPath: "/__nextgen", projectId: "proj_1" });

    expect(project.proxyPath).toBe("/__nextgen");
    expect(project.projectId).toBe("proj_1");
    expect(getApi(project).client.baseUrl).toBe("/__nextgen");
  });

  test("returns null before configuration", () => {
    expect(getZitadelConfig()).toBeNull();
  });

  test("freezes the returned project object", () => {
    const project = configureZitadel({ proxyPath: "/__nextgen", projectId: "proj_1" });
    expect(() => {
      (project as unknown as Record<string, unknown>).proxyPath = "/hacked";
    }).toThrow();
  });

  test("same-value re-call is a no-op", () => {
    const p1 = configureZitadel({ proxyPath: "/__nextgen", projectId: "proj_1" });
    const p2 = configureZitadel({ proxyPath: "/__nextgen", projectId: "proj_1" });
    expect(p1).toBe(p2);
  });

  test("different-value re-call warns and is ignored", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(vi.fn());
    const p1 = configureZitadel({ proxyPath: "/__nextgen", projectId: "proj_1" });
    const p2 = configureZitadel({ proxyPath: "/other", projectId: "proj_2" });

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0]![0]).toContain("already called with different values");
    expect(p2).toBe(p1);
    expect(p2.proxyPath).toBe("/__nextgen");
    warnSpy.mockRestore();
  });

  test("getZitadelConfig returns the same project handle", () => {
    const project = configureZitadel({ proxyPath: "/__nextgen", projectId: "proj_1" });
    expect(getZitadelConfig()).toBe(project);
  });

  test("shares state across distinct module instances via globalThis", async () => {
    vi.resetModules();
    const instanceA = await import("./config");
    vi.resetModules();
    const instanceB = await import("./config");

    expect(instanceA.configureZitadel).not.toBe(instanceB.configureZitadel);

    const projectFromA = instanceA.configureZitadel({
      proxyPath: "/__nextgen",
      projectId: "proj_shared",
    });

    expect(instanceB.getZitadelConfig()).toBe(projectFromA);

    instanceA._resetConfigForTesting();
    instanceB._resetConfigForTesting();
  });

  test("write-once guard fires across distinct module instances", async () => {
    vi.resetModules();
    const instanceA = await import("./config");
    vi.resetModules();
    const instanceB = await import("./config");

    instanceA.configureZitadel({ proxyPath: "/__nextgen", projectId: "proj_first" });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(vi.fn());
    const second = instanceB.configureZitadel({
      proxyPath: "/__nextgen",
      projectId: "proj_second",
    });

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(second.projectId).toBe("proj_first");
    warnSpy.mockRestore();

    instanceA._resetConfigForTesting();
    instanceB._resetConfigForTesting();
  });
});

describe("getApi", () => {
  test("returns a typed API client with all generated functions", () => {
    const project = configureZitadel({ proxyPath: "/__nextgen", projectId: "proj_1" });
    const api = getApi(project);

    expect(api).toBeDefined();
    expect(typeof api.createFlow).toBe("function");
    expect(typeof api.revokeMySession).toBe("function");
    expect(typeof api.getMySession).toBe("function");
  });

  test("returns the same instance for the same project handle", () => {
    const project = configureZitadel({ proxyPath: "/__nextgen", projectId: "proj_1" });
    const api1 = getApi(project);
    const api2 = getApi(project);
    expect(api1).toBe(api2);
  });

  test("a publishable key on the handle rides as the bearer (ADR 036)", async () => {
    const { base, authorizations } = await bearers();
    const project = configureZitadel({
      proxyPath: `${base}/__nextgen`,
      projectId: "proj_1",
      publishableKey: "pk_test_123",
    });
    expect(project.publishableKey).toBe("pk_test_123");

    await getApi(project).getLive();

    expect(authorizations).toEqual(["Bearer pk_test_123"]);
  });

  test("a handle without a publishable key produces token-less requests", async () => {
    const { base, authorizations } = await bearers();
    const project = configureZitadel({ proxyPath: `${base}/__nextgen`, projectId: "proj_1" });

    await getApi(project).getLive();

    expect(authorizations).toEqual([undefined]);
  });
});
