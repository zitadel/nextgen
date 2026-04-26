import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseJson, runCliForTest } from "../helpers/run-cli";

describe("identity resources", () => {
  it("idp add/list/show/remove round-trips through .zitadel/idps", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-idp-"));

    const add = await runCliForTest([
      "idp",
      "add",
      "--cwd",
      cwd,
      "--json",
      "--non-interactive",
      "--preset",
      "google",
      "--client-id",
      "abc.apps.googleusercontent.com",
      "--env-secret",
      "ZITADEL_IDP_GOOGLE_SECRET",
    ]);
    expect(add.exitCode).toBe(0);
    const addEnv = parseJson(add.stdout) as { status: string; data: { slug: string; path: string; created: boolean } };
    expect(addEnv.status).toBe("ok");
    expect(addEnv.data.slug).toBe("google");
    expect(addEnv.data.created).toBe(true);

    const contents = JSON.parse(await readFile(join(cwd, ".zitadel/idps/google.json"), "utf8")) as Record<string, unknown>;
    expect(contents.kind).toBe("idp");
    expect(contents.protocol).toBe("oidc");
    expect((contents.oidc as { client_id: string }).client_id).toBe("abc.apps.googleusercontent.com");
    expect((contents.oidc as { client_secret_env: string }).client_secret_env).toBe("ZITADEL_IDP_GOOGLE_SECRET");

    const list = await runCliForTest(["idp", "list", "--cwd", cwd, "--json"]);
    const listEnv = parseJson(list.stdout) as { data: { idps: Array<{ slug: string; protocol: string }> } };
    expect(listEnv.data.idps).toHaveLength(1);
    expect(listEnv.data.idps[0].slug).toBe("google");

    const show = await runCliForTest(["idp", "show", "google", "--cwd", cwd, "--json"]);
    expect(show.exitCode).toBe(0);
    const showEnv = parseJson(show.stdout) as { data: { idp: { slug: string } } };
    expect(showEnv.data.idp.slug).toBe("google");

    const duplicate = await runCliForTest([
      "idp",
      "add",
      "--cwd",
      cwd,
      "--json",
      "--non-interactive",
      "--preset",
      "google",
      "--client-id",
      "different.apps.googleusercontent.com",
      "--env-secret",
      "ZITADEL_IDP_GOOGLE_SECRET",
    ]);
    expect(duplicate.exitCode).toBe(5);
    expect((parseJson(duplicate.stdout) as { code: string }).code).toBe("E_CONFLICT");

    const remove = await runCliForTest(["idp", "remove", "google", "--cwd", cwd, "--json"]);
    expect(remove.exitCode).toBe(0);
    const removeEnv = parseJson(remove.stdout) as { status: string; data: { slug: string } };
    expect(removeEnv.status).toBe("ok");
    expect(removeEnv.data.slug).toBe("google");

    const listAfter = await runCliForTest(["idp", "list", "--cwd", cwd, "--json"]);
    const listAfterEnv = parseJson(listAfter.stdout) as { data: { idps: unknown[] } };
    expect(listAfterEnv.data.idps).toHaveLength(0);
  });

  it("app add writes a spa preset with redirect URIs", async () => {
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

    const contents = JSON.parse(await readFile(join(cwd, ".zitadel/apps/web.json"), "utf8")) as Record<string, unknown>;
    expect(contents.kind).toBe("app");
    expect(contents.protocol).toBe("oidc");
    expect((contents.oidc as { client_type: string }).client_type).toBe("spa");
    expect((contents.oidc as { redirect_uris: string[] }).redirect_uris).toContain("http://localhost:3000/callback");
  });

  it("does not advertise GitHub as an OIDC IdP preset", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-idp-github-"));
    const result = await runCliForTest([
      "idp",
      "add",
      "--cwd",
      cwd,
      "--json",
      "--non-interactive",
      "--preset",
      "github",
      "--client-id",
      "github-client",
      "--env-secret",
      "ZITADEL_IDP_GITHUB_SECRET",
    ]);
    expect(result.exitCode).toBe(3);
    const envelope = parseJson(result.stdout) as { code: string; hint?: string };
    expect(envelope.code).toBe("E_VALIDATION");
    expect(envelope.hint ?? "").not.toContain("github");
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
    const contents = JSON.parse(await readFile(join(cwd, ".zitadel/apps/spa.json"), "utf8")) as Record<string, unknown>;
    expect((contents.oidc as { client_type: string }).client_type).toBe("spa");
    expect((contents.oidc as { auth_methods: string[] }).auth_methods).toEqual(["none"]);
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
