import { afterEach, describe, expect, test, vi } from "vitest";

import { getProxyPath } from "./base-url";
import {
  configureZitadel,
  getApi,
  getZitadelConfig,
  _resetConfigForTesting,
} from "./config";

afterEach(() => {
  _resetConfigForTesting();
});

describe("configureZitadel", () => {
  test("sets config and syncs proxyPath", () => {
    const project = configureZitadel({ proxyPath: "/__nextgen", projectId: "proj_1" });

    expect(project.proxyPath).toBe("/__nextgen");
    expect(project.projectId).toBe("proj_1");
    expect(getProxyPath()).toBe("/__nextgen");
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

  test("handle is stored on globalThis so a duplicated module copy reads it", () => {
    // `@zitadel/components` bundles its own copy of this module. That
    // copy can't see this module's locals, but it CAN see globalThis. Simulate
    // the other copy by reading the shared symbol slot directly — it must hold
    // the very handle configureZitadel() returned here.
    const project = configureZitadel({ proxyPath: "/__nextgen", projectId: "proj_1" });
    const sharedSlot = (
      globalThis as Record<symbol, unknown>
    )[Symbol.for("@zitadel/api#currentProject")];
    expect(sharedSlot).toBe(project);
  });
});

describe("getApi", () => {
  test("returns a typed API client with all generated functions", () => {
    const project = configureZitadel({ proxyPath: "/__nextgen", projectId: "proj_1" });
    const api = getApi(project);

    expect(api).toBeDefined();
    expect(typeof api.createFlow).toBe("function");
    expect(typeof api.endSession).toBe("function");
    expect(typeof api.getMySession).toBe("function");
  });

  test("returns the same instance for the same project handle", () => {
    const project = configureZitadel({ proxyPath: "/__nextgen", projectId: "proj_1" });
    const api1 = getApi(project);
    const api2 = getApi(project);
    expect(api1).toBe(api2);
  });
});
