import { describe, expect, it } from "vitest";

import { angularProxyEdit } from "../../../../../../../src/lib/orca/patchers/rule/angular/angular-json";

const edit = angularProxyEdit({ proxyConfig: "proxy.conf.cjs", port: 4200 });

function ng(project: unknown): string {
  return JSON.stringify({ projects: { app: project } });
}

describe("angularProxyEdit", () => {
  it("wires proxyConfig and port into the serve target options", () => {
    const out = edit(ng({ architect: { serve: { options: {} } } }));
    const serve = JSON.parse(out).projects.app.architect.serve.options;
    expect(serve.proxyConfig).toBe("proxy.conf.cjs");
    expect(serve.port).toBe(4200);
  });

  it("supports the newer 'targets' key", () => {
    const out = edit(ng({ targets: { serve: {} } }));
    expect(JSON.parse(out).projects.app.targets.serve.options.proxyConfig).toBe("proxy.conf.cjs");
  });

  it("does not override an existing proxyConfig", () => {
    const out = edit(ng({ architect: { serve: { options: { proxyConfig: "mine.cjs" } } } }));
    expect(JSON.parse(out).projects.app.architect.serve.options.proxyConfig).toBe("mine.cjs");
  });

  it("resolves the project named by defaultProject", () => {
    const out = edit(
      JSON.stringify({
        defaultProject: "web",
        projects: { other: {}, web: { architect: { serve: { options: {} } } } },
      }),
    );
    expect(JSON.parse(out).projects.web.architect.serve.options.proxyConfig).toBe("proxy.conf.cjs");
  });

  it("throws when there is no project", () => {
    expect(() => edit(JSON.stringify({ projects: {} }))).toThrowError(/No project/);
  });

  it("throws when there is no serve target", () => {
    expect(() => edit(ng({ architect: {} }))).toThrowError(/serve/);
  });

  it("throws E_VALIDATION when the file is missing", () => {
    expect(() => edit(undefined)).toThrowError(/not found/);
  });
});
