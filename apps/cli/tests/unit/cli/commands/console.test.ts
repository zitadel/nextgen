import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { LocalRuntime } from "@/lib/server";
import { it } from "@tests/fixtures";
import { parseJson, runCliForTest } from "@tests/helpers/run-cli";

describe("console", () => {
  it("points at `zitadel start` when no local admin exists", async ({ dir: cwd }) => {
    const res = await runCliForTest(["console", "--cwd", cwd, "--json", "--no-open"], {
      HOME: cwd,
      USERPROFILE: cwd,
    });

    expect(res.exitCode).toBe(3);
    const json = parseJson(res.stdout) as {
      status: string;
      code: string;
      message: string;
      next_commands: string[];
    };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_VALIDATION");
    expect(json.message).toBe("No local admin in this directory or its parents");
    expect(json.next_commands.at(-1)).toMatch(/ start --cwd \S+$/);
  });

  it("names the server the directory recorded even where it refuses", async ({ dir: cwd }) => {
    await LocalRuntime.write(cwd, {
      schema_version: 1,
      backend: "docker",
      container_name: LocalRuntime.containerName(cwd),
      container_id: "container-test-id",
      image: "ghcr.io/zitadel/nextgen:test",
      port: 3000,
      server_url: "http://localhost:3000",
      data_dir: LocalRuntime.paths(cwd).dataDir,
      created_at: "2026-06-09T00:00:00.000Z",
      cli_version: "0.0.0-test",
    });

    const res = await runCliForTest(["console", "--cwd", cwd, "--json", "--no-open"], {
      HOME: cwd,
      USERPROFILE: cwd,
    });

    expect(res.exitCode).toBe(3);
    expect((parseJson(res.stdout) as { source: string }).source).toBe("http://localhost:3000");
  });

  it("signs in as the admin of a parent directory when run from an app inside it", async ({
    dir: parent,
  }) => {
    const { admin } = await LocalRuntime.forFolder(parent, {
      cliVersion: "0.0.0-test",
    }).ensureAdmin();
    const app = join(parent, "my-app");
    await mkdir(app);

    const res = await runCliForTest(["console", "--cwd", app, "--json", "--dry-run"]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as { data: { signed_in_as: string } };
    expect(json.data.signed_in_as).toBe(admin.email);
  });

  it("names the sign-in link it would mint on a dry run", async ({ dir: parent }) => {
    await LocalRuntime.forFolder(parent, { cliVersion: "0.0.0-test" }).ensureAdmin();

    const res = await runCliForTest(["console", "--cwd", parent, "--json", "--dry-run"]);

    const json = parseJson(res.stdout) as { data: { dry_run: boolean; title: string } };
    expect(json.data).toMatchObject({
      dry_run: true,
      title: "Would mint a console sign-in link (dry run)",
    });
  });

  it.for([
    ["a cloud project", "https://preview.zitadel.com", "https://preview.zitadel.com/console/"],
    ["a self-hosted project", "https://auth.example.com", "https://auth.example.com/ui/console/"],
  ])(
    "prints the console of %s without needing a local server",
    async ([, server, url], { dir }) => {
      const res = await runCliForTest(["console", "--cwd", dir, "--json", "--no-open"], {
        HOME: dir,
        USERPROFILE: dir,
        ZITADEL_URL: server,
      });

      expect(res.exitCode).toBe(0);
      const json = parseJson(res.stdout) as {
        status: string;
        source: string;
        data: { console_url: string; browser_opened: boolean };
      };
      expect(json.status).toBe("ok");
      expect(json.source).toBe(server);
      expect(json.data).toMatchObject({ console_url: url, browser_opened: false });
      expect(res.stdout).not.toContain("start");
    },
  );

  it("opens nothing on a dry run against a cloud project", async ({ dir }) => {
    const res = await runCliForTest(["console", "--cwd", dir, "--json", "--dry-run"], {
      HOME: dir,
      USERPROFILE: dir,
      ZITADEL_URL: "https://preview.zitadel.com",
    });

    const json = parseJson(res.stdout) as { data: { dry_run: boolean; console_url: string } };
    expect(json.data).toMatchObject({
      dry_run: true,
      console_url: "https://preview.zitadel.com/console/",
    });
  });

  it("still asks for a local admin when the project's server is on this machine", async ({
    dir,
  }) => {
    const res = await runCliForTest(["console", "--cwd", dir, "--json", "--no-open"], {
      HOME: dir,
      USERPROFILE: dir,
      ZITADEL_URL: "http://localhost:8080",
    });

    expect(res.exitCode).toBe(3);
    expect((parseJson(res.stdout) as { message: string }).message).toBe(
      "No local admin in this directory or its parents",
    );
  });

  it("keeps to the local console when a local server was started, whatever the project names", async ({
    dir,
  }) => {
    const { admin } = await LocalRuntime.forFolder(dir, { cliVersion: "0.0.0-test" }).ensureAdmin();

    const res = await runCliForTest(["console", "--cwd", dir, "--json", "--dry-run"], {
      HOME: dir,
      USERPROFILE: dir,
      ZITADEL_URL: "https://preview.zitadel.com",
    });

    expect((parseJson(res.stdout) as { data: { signed_in_as: string } }).data.signed_in_as).toBe(
      admin.email,
    );
  });

  it("prints the console of the server --server names, over the one the project names", async ({
    dir,
  }) => {
    const res = await runCliForTest(
      ["console", "--cwd", dir, "--json", "--no-open", "--server", "https://preview.zitadel.com"],
      { HOME: dir, USERPROFILE: dir, ZITADEL_URL: "https://auth.example.com" },
    );

    expect((parseJson(res.stdout) as { data: { console_url: string } }).data.console_url).toBe(
      "https://preview.zitadel.com/console/",
    );
  });

  it("names a server that is not a URL instead of saying no local admin exists", async ({
    dir,
  }) => {
    const res = await runCliForTest(["console", "--cwd", dir, "--json", "--no-open"], {
      HOME: dir,
      USERPROFILE: dir,
      ZITADEL_URL: "not a url",
    });

    expect(res.exitCode).toBe(3);
    expect((parseJson(res.stdout) as { message: string }).message).not.toBe(
      "No local admin in this directory or its parents",
    );
  });
});
