import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { envRefs, projectEnvRefs } from "../../../../src/lib/flows";

describe("projectEnvRefs", () => {
  it("unions the references from every JSON file under .zitadel, sorted", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-env-refs-"));
    const write = async (path: string, contents: object) => {
      await mkdir(join(cwd, ".zitadel", path, ".."), { recursive: true });
      await writeFile(join(cwd, ".zitadel", path), JSON.stringify(contents));
    };
    await write("schemas/human-user.json", { sso: { client_secret_env: "GOOGLE_CLIENT_SECRET" } });
    await write("flows/login.json", {
      steps: [{ hint: "${GOOGLE_CLIENT_SECRET}" }, { hint: "${API_KEY}" }],
    });
    await write("idps/github.json", { client_secret_env: "GITHUB_CLIENT_SECRET" });
    await write("branding/branding.json", { theme: "dark" });

    await expect(projectEnvRefs(cwd)).resolves.toEqual([
      "API_KEY",
      "GITHUB_CLIENT_SECRET",
      "GOOGLE_CLIENT_SECRET",
    ]);
  });

  it("skips .zitadel/local, which the runtime writes while running", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-env-refs-"));
    await mkdir(join(cwd, ".zitadel", "local", "nextgen-data"), { recursive: true });
    await writeFile(join(cwd, ".zitadel", "local", "runtime.json"), '{"x":"${FROM_RUNTIME}"}');
    await writeFile(join(cwd, ".zitadel", "local", "nextgen-data", "half.json"), "{not json");
    await mkdir(join(cwd, ".zitadel", "flows"), { recursive: true });
    await writeFile(join(cwd, ".zitadel", "flows", "login.json"), '{"hint":"${FROM_FLOW}"}');

    await expect(projectEnvRefs(cwd)).resolves.toEqual(["FROM_FLOW"]);
  });

  it("names the file when a resource is not valid JSON", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-env-refs-"));
    await mkdir(join(cwd, ".zitadel", "flows"), { recursive: true });
    await writeFile(join(cwd, ".zitadel", "flows", "broken.json"), "{oops");

    await expect(projectEnvRefs(cwd)).rejects.toThrow(/flows\/broken\.json is not valid JSON/);
  });

  it("returns nothing when the project has no .zitadel directory", async () => {
    await expect(projectEnvRefs(await mkdtemp(join(tmpdir(), "zitadel-bare-")))).resolves.toEqual(
      [],
    );
  });
});

describe("envRefs", () => {
  it("detects ${VAR} placeholders inside strings", () => {
    expect(envRefs({ url: "${ZITADEL_API_BASE}/foo" })).toEqual(["ZITADEL_API_BASE"]);
  });

  it("detects *_env convention keys on nested objects", () => {
    const resource = {
      version: 1,
      name: "default",
      config: {
        token: "abc",
        secret_env: "ZITADEL_DEMO_SECRET",
      },
    };
    expect(envRefs(resource)).toEqual(["ZITADEL_DEMO_SECRET"]);
  });

  it("merges both conventions and deduplicates", () => {
    const bundle = {
      ".zitadel/flows/login.json": {
        gate: { secret_env: "CAPTCHA_SECRET" },
      },
      ".zitadel/flows/register.json": {
        gate: { issuer: "${GATE_ISSUER}", secret_env: "GATE_SECRET" },
      },
      server: "${ZITADEL_API_BASE}",
    };
    expect(envRefs(bundle)).toEqual([
      "CAPTCHA_SECRET",
      "GATE_ISSUER",
      "GATE_SECRET",
      "ZITADEL_API_BASE",
    ]);
  });

  it("ignores *_env keys whose value is not a plain env var name", () => {
    const resource = { gate: { secret_env: "not a var name" } };
    expect(envRefs(resource)).toEqual([]);
  });
});
