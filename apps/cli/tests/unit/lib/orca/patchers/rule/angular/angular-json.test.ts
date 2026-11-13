import { describe, expect, it } from "vitest";

import {
  angularDefineGuardEdit,
  angularProxyEdit,
} from "@/lib/orca/patchers/rule/angular/angular-json";

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

  it("returns the source untouched when proxyConfig and port are already set", () => {
    const once = edit(ng({ architect: { serve: { options: {} } } }));
    expect(edit(once)).toBe(once);
  });

  it("moves a serve port still on the port the app is moving off", () => {
    const move = angularProxyEdit({
      proxyConfig: "proxy.conf.cjs",
      port: 4300,
      previousPort: 4200,
    });
    const out = move(ng({ architect: { serve: { options: { port: 4200 } } } }));
    expect(JSON.parse(out).projects.app.architect.serve.options.port).toBe(4300);
  });

  it("keeps a serve port the app is not moving off", () => {
    const move = angularProxyEdit({
      proxyConfig: "proxy.conf.cjs",
      port: 4300,
      previousPort: 4200,
    });
    const out = move(ng({ architect: { serve: { options: { port: 5000 } } } }));
    expect(JSON.parse(out).projects.app.architect.serve.options.port).toBe(5000);
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

  it("throws on multiple projects with no defaultProject instead of guessing", () => {
    expect(() =>
      edit(
        JSON.stringify({
          projects: {
            web: { architect: { serve: { options: {} } } },
            admin: { architect: { serve: { options: {} } } },
          },
        }),
      ),
    ).toThrowError(/multiple projects/);
  });

  it("throws when there is no serve target", () => {
    expect(() => edit(ng({ architect: {} }))).toThrowError(/serve/);
  });

  it("throws E_VALIDATION when the file is missing", () => {
    expect(() => edit(undefined)).toThrowError(/not found/);
  });
});

describe("angularDefineGuardEdit", () => {
  const guard = angularDefineGuardEdit({ name: "ID", message: "ID is not set: run npm run dev" });

  it("defines the message for a plain serve and a plain production build", () => {
    const out = guard(
      ng({
        architect: {
          build: { configurations: { production: {}, development: {} } },
          serve: { options: { port: 4200 } },
          test: {},
        },
      }),
    );

    const targets = JSON.parse(out).projects.app.architect;
    expect(targets.serve.options).toEqual({
      port: 4200,
      define: { ID: "ID is not set: run npm run dev" },
    });
    expect(targets.build.configurations).toEqual({
      production: { define: { ID: "ID is not set: run npm run dev" } },
      development: {},
    });
    expect(targets.test).toEqual({});
  });

  it("keeps the project's own defines, and a value it set for the name", () => {
    const source = ng({
      architect: {
        build: { configurations: { production: { define: { ID: '"proj_own"' } } } },
        serve: { options: { define: { OTHER: "1" } } },
      },
    });

    const targets = JSON.parse(guard(source)).projects.app.architect;

    expect(targets.build.configurations.production.define).toEqual({ ID: '"proj_own"' });
    expect(targets.serve.options.define).toEqual({
      OTHER: "1",
      ID: "ID is not set: run npm run dev",
    });
  });

  it("returns the source untouched once both are set, and without a production configuration", () => {
    const once = guard(ng({ architect: { build: {}, serve: { options: {} } } }));
    expect(guard(once)).toBe(once);
    expect(JSON.parse(once).projects.app.architect.build).toEqual({});
  });
});
