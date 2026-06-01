import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import type { ProjectContext } from "../adapters";
import { getAdapter } from "../adapters/registry";
import { detectDeployTarget } from "../deploy";
import { detectFramework } from "../detect/framework";
import { detectPackageManager } from "../detect/package-manager";
import { detectDevPort, issuerFromPort } from "../detect/port";
import type { CliIO, GlobalOptions } from "../io/output";
import { ok } from "../io/output";
import { ZitadelError } from "../lib/errors";
import { MANAGED_MARKER } from "../lib/paths";
import { getRenderer } from "../renderers/registry";
import { scaffold } from "../scaffolder";
import type { ScaffoldPlan } from "../scaffolder/plan";
import { validateJsonSchema } from "../schema/validate";
import { readZitadelConfig, readZitadelSecret } from "./shared";

export type DoctorOptions = GlobalOptions & {
  fix?: boolean;
};

type DoctorCheck = {
  name: string;
  status: "pass" | "fail";
  message: string;
  path?: string;
};

export async function runDoctor(io: CliIO, opts: DoctorOptions): Promise<void> {
  if (opts.fix) {
    await applyFixes(opts);
  }

  const checks = await collectChecks(opts.cwd);
  const failed = checks.filter((check) => check.status === "fail");
  const data = {
    title: failed.length === 0 ? "Zitadel doctor passed." : "Zitadel doctor found issues.",
    ok: failed.length === 0,
    checks,
  };

  if (failed.length > 0) {
    throw new ZitadelError("E_VALIDATION", "Zitadel doctor found issues", {
      hint: "Run `npx zitadel@latest doctor --fix` to re-apply missing managed files.",
      details: data,
    });
  }

  ok(io, data, opts);
}

async function collectChecks(cwd: string): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const config = await check(
    "config",
    "zitadel.json parses",
    "zitadel.json",
    async () => readZitadelConfig(cwd),
    checks,
  );
  const secret = await check(
    "secret",
    ".zitadel/secret parses",
    ".zitadel/secret",
    async () => readZitadelSecret(cwd),
    checks,
  );

  await check(
    "secret-permissions",
    ".zitadel/secret has 0600 permissions",
    ".zitadel/secret",
    async () => {
      const mode = (await stat(join(cwd, ".zitadel/secret"))).mode & 0o777;
      if (mode !== 0o600) {
        throw new Error(`expected 0600, got ${mode.toString(8)}`);
      }
    },
    checks,
  );

  await check(
    "gitignore",
    ".gitignore protects local secret/env files",
    ".gitignore",
    async () => {
      const contents = await readFile(join(cwd, ".gitignore"), "utf8");
      for (const entry of [".zitadel/secret", ".env*", "!.env.example"]) {
        if (!contents.split(/\r?\n/g).includes(entry)) {
          throw new Error(`missing ${entry}`);
        }
      }
    },
    checks,
  );

  await check(
    "env-example",
    ".env.example references required keys",
    ".env.example",
    async () => {
      const contents = await readFile(join(cwd, ".env.example"), "utf8");
      for (const key of ["ZITADEL_PROJECT_ID", "ZITADEL_ENVIRONMENT", "ZITADEL_ISSUER"]) {
        if (!contents.includes(`${key}=`)) {
          throw new Error(`missing ${key}`);
        }
      }
    },
    checks,
  );

  await check(
    "framework",
    "Detected framework matches recorded framework",
    "zitadel.json",
    async () => {
      const detected = await detectFramework(cwd, "next");
      const recorded =
        isObject(config) && isObject(config.framework) ? config.framework.id : undefined;
      if (recorded !== detected.id) {
        throw new Error(`expected ${String(recorded)}, detected ${detected.id}`);
      }
    },
    checks,
  );

  await check(
    "schema",
    "User schema is a valid JSON Schema",
    ".zitadel/schemas/user.json",
    async () => {
      const schema = JSON.parse(
        await readFile(join(cwd, ".zitadel/schemas/user.json"), "utf8"),
      ) as unknown;
      const result = validateJsonSchema(schema);
      if (!result.valid) {
        throw new Error(result.errors.join(", "));
      }
    },
    checks,
  );

  await check(
    "managed-login",
    "Login page contains Zitadel managed marker",
    "app/login/page.tsx",
    async () => {
      await assertManagedFile(cwd, ["app/login/page.tsx", "src/app/login/page.tsx"]);
    },
    checks,
  );

  await check(
    "managed-register",
    "Register page contains Zitadel managed marker",
    "app/register/page.tsx",
    async () => {
      await assertManagedFile(cwd, ["app/register/page.tsx", "src/app/register/page.tsx"]);
    },
    checks,
  );

  await check(
    "managed-middleware",
    "Next middleware.ts contains Zitadel managed marker",
    "middleware.ts",
    async () => {
      await assertManagedFile(cwd, ["middleware.ts", "src/middleware.ts"]);
    },
    checks,
  );

  await check(
    "deploy",
    "Deploy platform status resolved",
    "zitadel.json",
    async () => {
      const adapter = await detectDeployTarget(cwd);
      const status = await adapter.status(cwd);
      if (status.state !== "ready" && status.state !== "not-detected") {
        return `deploy platform ${status.platform} is ${status.state}`;
      }
      return status.state;
    },
    checks,
  );

  if (secret && config && secret.project_id !== config.project) {
    checks.push({
      name: "project-match",
      status: "fail",
      message: ".zitadel/secret project_id does not match zitadel.json project",
      path: ".zitadel/secret",
    });
  } else {
    checks.push({
      name: "project-match",
      status: "pass",
      message: ".zitadel/secret project_id matches zitadel.json project",
      path: ".zitadel/secret",
    });
  }

  return checks;
}

async function applyFixes(opts: DoctorOptions): Promise<void> {
  const config = await readZitadelConfig(opts.cwd);
  const secret = await readZitadelSecret(opts.cwd);
  const framework = await detectFramework(opts.cwd, "next");
  const packageManager = await detectPackageManager(opts.cwd);
  const adapter = getAdapter(framework.id);
  const issuer = await resolveIssuer(opts.cwd, config);
  const rendererId = readRendererId(config);
  const renderer = getRenderer(rendererId);
  const ctx: ProjectContext = {
    cwd: opts.cwd,
    packageManager,
    framework,
    renderer,
    config: {
      project_id: secret.project_id,
      issuer,
      preview_origins: secret.preview_origins,
      userSchemaPath: ".zitadel/schemas/user.json",
    },
    isInitialSetup: false,
  };
  const recordedServer = typeof config.server === "string" ? config.server : "";
  const plan: ScaffoldPlan = {
    ops: [
      { kind: "append-gitignore", entries: [".zitadel/secret", ".env*", "!.env.example"] },
      {
        kind: "merge-env",
        path: ".env.example",
        entries: {
          ZITADEL_PROJECT_ID: "",
          ZITADEL_ENVIRONMENT: "",
          ZITADEL_ISSUER: "",
          ZITADEL_URL: "",
        },
      },
      {
        kind: "merge-env",
        path: ".env.local",
        entries: {
          ZITADEL_PROJECT_ID: secret.project_id,
          ZITADEL_ENVIRONMENT: "development",
          ZITADEL_ISSUER: issuer,
          ZITADEL_URL: recordedServer,
        },
      },
      ...(await adapter.planSetup(ctx)).ops,
    ],
    summary: [{ title: "Doctor fix", detail: "Re-applied missing managed files." }],
  };
  // Managed files carry a marker; `doctor --fix` is expected to reclaim them
  // even if they have local edits. Unmanaged files stay protected by the conflict guard.
  await scaffold(plan, { cwd: opts.cwd, dryRun: opts.dryRun, force: true });
}

async function check<T>(
  name: string,
  successMessage: string,
  path: string,
  fn: () => Promise<T>,
  checks: DoctorCheck[],
): Promise<T | undefined> {
  try {
    const value = await fn();
    checks.push({ name, status: "pass", message: successMessage, path });
    return value;
  } catch (error) {
    checks.push({
      name,
      status: "fail",
      message: error instanceof Error ? error.message : String(error),
      path,
    });
    return undefined;
  }
}

async function assertManagedFile(cwd: string, candidates: string[]): Promise<void> {
  for (const candidate of candidates) {
    try {
      const contents = await readFile(join(cwd, candidate), "utf8");
      if (!contents.includes(MANAGED_MARKER)) {
        throw new Error(`${candidate} is missing managed marker`);
      }
      return;
    } catch (error) {
      if (
        !(
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error as { code?: string }).code === "ENOENT"
        )
      ) {
        throw error;
      }
    }
  }
  throw new Error(`missing one of ${candidates.join(", ")}`);
}

function readIssuer(config: Record<string, unknown>): unknown {
  return isObject(config.environments) && isObject(config.environments.development)
    ? config.environments.development.issuer
    : undefined;
}

function readRendererId(config: Record<string, unknown>): string {
  const branding = isObject(config.branding) ? config.branding : undefined;
  const value = branding && typeof branding.renderer === "string" ? branding.renderer : "react";
  return value === "default" ? "react" : value;
}

async function resolveIssuer(cwd: string, config: Record<string, unknown>): Promise<string> {
  const fromConfig = readIssuer(config);
  if (typeof fromConfig === "string" && fromConfig.length > 0) return fromConfig;
  const state = await readState(cwd);
  if (typeof state?.dev_port === "number") return `http://localhost:${state.dev_port}`;
  const detected = await detectDevPort(cwd);
  return issuerFromPort(detected);
}

async function readState(cwd: string): Promise<{ dev_port?: number } | undefined> {
  try {
    const contents = await readFile(join(cwd, ".zitadel/state.json"), "utf8");
    return JSON.parse(contents) as { dev_port?: number };
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
