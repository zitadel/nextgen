import { afterEach, describe, expect, test, vi } from "vitest";

import { getApiBaseUrl } from "./base-url";
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
  test("sets config and syncs apiBaseUrl", () => {
    const project = configureZitadel({ apiBase: "/__nextgen", projectId: "proj_1" });

    expect(project.apiBase).toBe("/__nextgen");
    expect(project.projectId).toBe("proj_1");
    expect(getApiBaseUrl()).toBe("/__nextgen");
  });

  test("returns null before configuration", () => {
    expect(getZitadelConfig()).toBeNull();
  });

  test("freezes the returned project object", () => {
    const project = configureZitadel({ apiBase: "/__nextgen", projectId: "proj_1" });
    expect(() => {
      (project as unknown as Record<string, unknown>).apiBase = "/hacked";
    }).toThrow();
  });

  test("same-value re-call is a no-op", () => {
    const p1 = configureZitadel({ apiBase: "/__nextgen", projectId: "proj_1" });
    const p2 = configureZitadel({ apiBase: "/__nextgen", projectId: "proj_1" });
    expect(p1).toBe(p2);
  });

  test("different-value re-call warns and is ignored", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(vi.fn());
    const p1 = configureZitadel({ apiBase: "/__nextgen", projectId: "proj_1" });
    const p2 = configureZitadel({ apiBase: "/other", projectId: "proj_2" });

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0]![0]).toContain("already called with different values");
    expect(p2).toBe(p1);
    expect(p2.apiBase).toBe("/__nextgen");
    warnSpy.mockRestore();
  });

  test("getZitadelConfig returns the same project handle", () => {
    const project = configureZitadel({ apiBase: "/__nextgen", projectId: "proj_1" });
    expect(getZitadelConfig()).toBe(project);
  });
});

describe("getApi", () => {
  test("returns a typed API client with all generated functions", () => {
    const project = configureZitadel({ apiBase: "/__nextgen", projectId: "proj_1" });
    const api = getApi(project);

    expect(api).toBeDefined();
    expect(typeof api.createFlow).toBe("function");
    expect(typeof api.endSession).toBe("function");
    expect(typeof api.getMySession).toBe("function");
  });

  test("returns the same instance for the same project handle", () => {
    const project = configureZitadel({ apiBase: "/__nextgen", projectId: "proj_1" });
    const api1 = getApi(project);
    const api2 = getApi(project);
    expect(api1).toBe(api2);
  });
});
