import { _resetConfigForTesting, configureZitadel } from "@zitadel/api/config";
import type { ComponentProps } from "solid-js";
import { hydrate } from "solid-js/web";
import { createServer } from "vite";
import solid from "vite-plugin-solid";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ZitadelLogin } from "./index";

/**
 * The wrapper's server markup. The server compile of `./index` cannot share a
 * module graph with this file's hydration compile, so a throwaway Vite server
 * loads it with `vite-plugin-solid({ ssr: true })`. The widget's own module is
 * kept out of that load (it is already registered in this jsdom window).
 */
async function serverMarkup(props: ComponentProps<typeof ZitadelLogin>): Promise<string> {
  const server = await createServer({
    configFile: false,
    logLevel: "silent",
    plugins: [solid({ ssr: true })],
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
    ssr: { external: ["@zitadel/components", "@zitadel/api"] },
  });
  const define = vi.spyOn(customElements, "define").mockImplementation(() => {});
  try {
    const solidJs = (await server.ssrLoadModule("solid-js")) as typeof import("solid-js");
    const web = (await server.ssrLoadModule("solid-js/web")) as typeof import("solid-js/web");
    const sdk = (await server.ssrLoadModule("/src/index.tsx")) as typeof import("./index");
    return web.renderToString(() => solidJs.createComponent(sdk.ZitadelLogin, props));
  } finally {
    define.mockRestore();
    await server.close();
  }
}

describe("hydrating a server-rendered login", () => {
  afterEach(() => {
    _resetConfigForTesting();
    vi.restoreAllMocks();
  });

  it("starts its first flow with the purpose the server rendered", async () => {
    const globalProject = configureZitadel({
      projectId: "proj-global",
      proxyPath: "https://flow.test.invalid",
    });
    const fetched = vi.spyOn(globalThis, "fetch");
    const host = document.createElement("div");
    document.body.appendChild(host);
    host.innerHTML = await serverMarkup({ project: globalProject, purpose: "register" });
    const firstStep = new Promise((resolve) =>
      host
        .querySelector("zitadel-login")
        ?.addEventListener("zitadel-flow-step", resolve, { once: true }),
    );

    // What the server's hydration script defines before the client hydrates.
    Object.assign(window, { _$HY: { events: [], completed: new WeakSet(), r: {} } });
    const dispose = hydrate(
      () => <ZitadelLogin project={globalProject} purpose="register" />,
      host,
    );

    await firstStep;
    const bodies = await Promise.all(
      fetched.mock.calls.map(async ([input, init]) =>
        JSON.parse(
          String(init?.body ?? (input instanceof Request ? await input.clone().text() : "null")),
        ),
      ),
    );
    const created = bodies.filter((body) => body?.project_id);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ purpose: "register" });
    dispose();
    host.remove();
  });
});
