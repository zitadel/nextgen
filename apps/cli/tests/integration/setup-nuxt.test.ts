import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  resetPlatformStore,
  setupPlatformHandlers,
} from "@zitadel-nextgen/api-mock/platform";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { parseJson, runCliForTest } from "../helpers/run-cli";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(async function* () {
    yield { type: "result" };
  }),
}));

const MOCK_SERVER_URL = "http://mock.zitadel.test";

const server = setupServer(...setupPlatformHandlers());

beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
afterAll(() => server.close());
afterEach(() => {
  server.resetHandlers();
  resetPlatformStore();
});

function cli(args: string[], env: NodeJS.ProcessEnv = {}) {
  return runCliForTest(["--server", MOCK_SERVER_URL, ...args], env);
}

describe("Nuxt setup integration", () => {
  it("writes base config files and runs the agent for a Nuxt project", async () => {
    const cwd = await createNuxtProject();

    const setup = await cli([
      "setup",
      "--cwd",
      cwd,
      "--non-interactive",
      "--json",
      "--skip-deploy-platform",
    ]);

    expect(setup.exitCode).toBe(0);
    const setupJson = parseJson(setup.stdout) as {
      status: string;
      data: { project: { lifecycle: string } };
    };
    expect(setupJson.status).toBe("ok");
    expect(setupJson.data.project.lifecycle).toBe("pre-claim");

    expect(await readFile(join(cwd, "zitadel.json"), "utf8")).toContain('"project"');
    expect(await readFile(join(cwd, "zitadel.json"), "utf8")).toContain('"nuxt"');

    const envLocal = await readFile(join(cwd, ".env.local"), "utf8");
    expect(envLocal).toContain("NEXTGEN_ISSUER_URL=");
    expect(envLocal).toContain("ZITADEL_PROJECT_ID=");
    expect(envLocal).toContain("ZITADEL_ENVIRONMENT=development");
    expect(envLocal).not.toContain("NEXT_PUBLIC_");

    const envExample = await readFile(join(cwd, ".env.example"), "utf8");
    expect(envExample).toContain("NEXTGEN_ISSUER_URL=");

    expect((await stat(join(cwd, ".zitadel/secret"))).mode & 0o777).toBe(0o600);

    const flowRaw = await readFile(join(cwd, ".zitadel/flows/default.json"), "utf8");
    expect(flowRaw).toContain('"name": "default"');

    const localeRaw = await readFile(join(cwd, ".zitadel/locales/en.json"), "utf8");
    expect(localeRaw).toContain('"identifier.title": "Sign in"');

    const stateRaw = await readFile(join(cwd, ".zitadel/state.json"), "utf8");
    expect(stateRaw).toContain('"nuxt"');
  });
});

async function createNuxtProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-nuxt-"));
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify(
      {
        name: "demo-nuxt-app",
        private: true,
        dependencies: {
          nuxt: "^3.13.0",
          vue: "^3.5.0",
        },
      },
      null,
      2,
    ),
  );
  await writeFile(join(cwd, ".gitignore"), "node_modules\n");
  await writeFile(
    join(cwd, "nuxt.config.ts"),
    "export default defineNuxtConfig({ compatibilityDate: '2024-11-01' })\n",
  );
  return cwd;
}
