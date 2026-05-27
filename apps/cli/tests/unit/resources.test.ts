import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseJson, runCliForTest } from "../helpers/run-cli";

describe("identity resources", () => {
  it("app add/list/show/remove round-trips through .zitadel/apps", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-app-"));
    const result = await runCliForTest([
      "app",
      "add",
      "--cwd",
      cwd,
      "--json",
      "--non-interactive",
      "--preset",
      "spa",
      "--slug",
      "web",
      "--redirect-uri",
      "http://localhost:3000/callback",
    ]);
    expect(result.exitCode).toBe(0);
    const envelope = parseJson(result.stdout) as { status: string; data: { slug: string } };
    expect(envelope.status).toBe("ok");
    expect(envelope.data.slug).toBe("web");

    const contents = JSON.parse(
      await readFile(join(cwd, ".zitadel/apps/web.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(contents.kind).toBe("app");
    expect(contents.protocol).toBe("oidc");
    expect((contents.oidc as { client_type: string }).client_type).toBe("spa");
    expect((contents.oidc as { redirect_uris: string[] }).redirect_uris).toContain(
      "http://localhost:3000/callback",
    );

    const list = await runCliForTest(["app", "list", "--cwd", cwd, "--json"]);
    const listEnv = parseJson(list.stdout) as {
      data: { apps: Array<{ slug: string; protocol: string }> };
    };
    expect(listEnv.data.apps).toHaveLength(1);
    expect(listEnv.data.apps[0]?.slug).toBe("web");

    const show = await runCliForTest(["app", "show", "web", "--cwd", cwd, "--json"]);
    expect(show.exitCode).toBe(0);
    const showEnv = parseJson(show.stdout) as { data: { app: { slug: string } } };
    expect(showEnv.data.app.slug).toBe("web");

    const remove = await runCliForTest(["app", "remove", "web", "--cwd", cwd, "--json"]);
    expect(remove.exitCode).toBe(0);
    const removeEnv = parseJson(remove.stdout) as { status: string; data: { slug: string } };
    expect(removeEnv.status).toBe("ok");
    expect(removeEnv.data.slug).toBe("web");

    const listAfter = await runCliForTest(["app", "list", "--cwd", cwd, "--json"]);
    const listAfterEnv = parseJson(listAfter.stdout) as { data: { apps: unknown[] } };
    expect(listAfterEnv.data.apps).toHaveLength(0);
  });

  it("app add accepts --client-type for OIDC without a preset", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-app-ct-"));
    const result = await runCliForTest([
      "app",
      "add",
      "--cwd",
      cwd,
      "--json",
      "--non-interactive",
      "--protocol",
      "oidc",
      "--slug",
      "spa",
      "--client-type",
      "spa",
      "--redirect-uri",
      "http://localhost:3000/callback",
    ]);
    expect(result.exitCode).toBe(0);
    const contents = JSON.parse(
      await readFile(join(cwd, ".zitadel/apps/spa.json"), "utf8"),
    ) as Record<string, unknown>;
    expect((contents.oidc as { client_type: string }).client_type).toBe("spa");
    expect((contents.oidc as { auth_methods: string[] }).auth_methods).toEqual(["none"]);
  });

  it("app add rejects invalid protocol values", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-app-protocol-"));
    const result = await runCliForTest([
      "app",
      "add",
      "--cwd",
      cwd,
      "--json",
      "--non-interactive",
      "--protocol",
      "oauth2",
      "--slug",
      "bad",
      "--entity-id",
      "urn:bad",
    ]);
    expect(result.exitCode).toBe(3);
    const envelope = parseJson(result.stdout) as { code: string; message: string; hint?: string };
    expect(envelope.code).toBe("E_VALIDATION");
    expect(envelope.message).toContain("Invalid --protocol");
    expect(envelope.hint).toContain("oidc, saml");
  });

  it("app add rejects --role with --protocol oidc", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-app-role-"));
    const result = await runCliForTest([
      "app",
      "add",
      "--cwd",
      cwd,
      "--json",
      "--non-interactive",
      "--protocol",
      "oidc",
      "--slug",
      "bad",
      "--role",
      "client",
    ]);
    expect(result.exitCode).toBe(3);
    const envelope = parseJson(result.stdout) as { code: string; hint?: string };
    expect(envelope.code).toBe("E_VALIDATION");
    expect(envelope.hint ?? "").toContain("--client-type");
  });

  it("app list is empty in a fresh cwd without .zitadel/apps", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-app-empty-"));
    const result = await runCliForTest(["app", "list", "--cwd", cwd, "--json"]);
    expect(result.exitCode).toBe(0);
    expect((parseJson(result.stdout) as { data: { apps: unknown[] } }).data.apps).toHaveLength(0);
  });
});
