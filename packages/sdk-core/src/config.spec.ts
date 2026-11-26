import {
  _resetConfigForTesting,
  type ZitadelConfig as ApiConfig,
  type ZitadelProject as ApiProject,
} from "@zitadel/api/config";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";

import {
  configureZitadel,
  getApi,
  getZitadelConfig,
  type ZitadelConfig,
  type ZitadelProject,
} from "./config.js";

afterEach(() => {
  _resetConfigForTesting();
});

describe("the configuration the SDKs declare themselves", () => {
  it("accepts everything the API package accepts, and the API package accepts everything it does", () => {
    expectTypeOf<ApiConfig>().toExtend<ZitadelConfig>();
    expectTypeOf<ZitadelConfig>().toExtend<ApiConfig>();
  });

  it("is the same handle as the API package's, field for field", () => {
    expectTypeOf<ApiProject>().toExtend<ZitadelProject>();
    expectTypeOf<ZitadelProject>().toExtend<ApiProject>();
  });
});

describe("configureZitadel", () => {
  it("returns a frozen handle that carries the project and the default proxy path", () => {
    const project = configureZitadel({ projectId: "p1" });

    expect(project).toMatchObject({ projectId: "p1", proxyPath: "/__nextgen" });
    expect(Object.isFrozen(project)).toBe(true);
  });

  it("returns the original handle when it is called again with the same values", () => {
    const first = configureZitadel({ projectId: "p1", proxyPath: "/px" });

    expect(configureZitadel({ projectId: "p1", proxyPath: "/px" })).toBe(first);
  });

  it("keeps the original handle and warns when it is called again with other values", () => {
    const first = configureZitadel({ projectId: "p1" });
    const warnings: unknown[][] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    try {
      expect(configureZitadel({ projectId: "p2" })).toBe(first);
    } finally {
      console.warn = warn;
    }

    expect(warnings).toHaveLength(1);
  });
});

describe("getZitadelConfig", () => {
  it("is null before the project is configured", () => {
    expect(getZitadelConfig()).toBeNull();
  });

  it("returns the handle that configureZitadel registered", () => {
    const project = configureZitadel({ projectId: "p1" });

    expect(getZitadelConfig()).toBe(project);
  });
});

describe("getApi", () => {
  it("returns the same client for the same handle", () => {
    const project = configureZitadel({ projectId: "p1" });

    expect(getApi(project)).toBe(getApi(project));
  });
});
