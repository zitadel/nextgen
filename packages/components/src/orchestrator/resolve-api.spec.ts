import { configureZitadel, _resetConfigForTesting } from "@zitadel/api/config";
import { afterEach, describe, expect, it } from "vitest";

import { resolveProject } from "./resolve-api.js";

const NO_ATTRS = { projectId: "", proxyPath: "", url: "" };

afterEach(() => {
  _resetConfigForTesting();
});

describe("resolveProject", () => {
  it("is undefined when nothing configures a project", () => {
    expect(resolveProject(undefined, NO_ATTRS)).toBeUndefined();
  });

  it("builds the project from the attributes, defaulting the proxy path", () => {
    expect(resolveProject(undefined, { ...NO_ATTRS, projectId: "demo" })).toEqual({
      projectId: "demo",
      proxyPath: "/__nextgen",
      url: undefined,
    });
  });

  it("prefers the global handle over the attributes", () => {
    const global = configureZitadel({ projectId: "global", proxyPath: "/g" });
    expect(resolveProject(undefined, { ...NO_ATTRS, projectId: "demo" })).toBe(global);
  });

  it("prefers the project property over the global handle", () => {
    configureZitadel({ projectId: "global", proxyPath: "/g" });
    const handle = { projectId: "own", proxyPath: "/o" };
    expect(resolveProject(handle, { ...NO_ATTRS, projectId: "demo" })).toBe(handle);
  });
});
