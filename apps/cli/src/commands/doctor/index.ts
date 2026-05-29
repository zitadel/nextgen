import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { Flags } from "@oclif/core";

import { BaseCommand, type CommandResult, type GlobalOptions, type JsonEnvelope } from "../../lib/oclif";
import { ZitadelError } from "../../lib/errors";
import { isAuthMethod } from "../../lib/flows";
import { isObject } from "../../lib/json";
import { createOrca, issuerFromPort, type FrameworkFacts, type Orca } from "../../lib/orca";
import type { PatchContext } from "../../lib/orca/patchers/types";
import type { UserSchema } from "../../lib/user-schema";
import { readDevelopmentIssuer, readRendererId, readZitadelConfig, readZitadelSecret } from "../../lib/project";
import { SANITY_CHECKS } from "./checks";

/**
 * Options for {@link runDoctor}. When `fix` is set, doctor re-applies the
 * managed scaffold (reclaiming managed files, even locally edited ones)
 * before running its checks.
 */
export type DoctorOptions = GlobalOptions & {
  fix?: boolean;
};

/**
 * Diagnoses a Zitadel-managed project and, with `fix`, repairs it first.
 *
 * Runs every registered {@link SANITY_CHECKS} entry and emits the aggregate
 * result. If any check fails it throws `E_VALIDATION` carrying the full check
 * details so the caller can render them.
 */
export async function runDoctor(opts: DoctorOptions): Promise<CommandResult> {
  const orca = createOrca();
  if (opts.fix) {
    await applyFixes(opts, orca);
  }

  const checks = await Promise.all(SANITY_CHECKS.map((check) => check.run({ cwd: opts.cwd, orca })));
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

  return { status: "ok", data };
}

async function applyFixes(opts: DoctorOptions, orca: Orca): Promise<void> {
  const ctx = await loadPatchContext(opts.cwd, orca);
  // `repair` reclaims the managed artifacts — env files, gitignore, the SDK
  // dependency, and marker-bearing routes/middleware — even when locally edited,
  // while leaving the user-editable `.zitadel/` resource files untouched.
  await orca
    .patcherFor(ctx.framework.id)
    .repair(ctx, { cwd: opts.cwd, dryRun: opts.dryRun, force: true });
}

/**
 * Reconstructs a {@link PatchContext} from the on-disk project (config, secret,
 * user schema) plus fresh framework detection, so `doctor --fix` can rebuild the
 * patcher plan. Auth method and fields are read back from the user schema; their
 * exact values only affect the `.zitadel/` resource contents, which `--fix`
 * filters out anyway.
 */
async function loadPatchContext(cwd: string, orca: Orca): Promise<PatchContext> {
  const config = await readZitadelConfig(cwd);
  const secret = await readZitadelSecret(cwd);
  const framework = await orca.detect(cwd);
  const raw = JSON.parse(
    await readFile(join(cwd, ".zitadel/schemas/user.json"), "utf8"),
  ) as Record<string, unknown>;
  const properties = isObject(raw.properties) ? raw.properties : {};
  const authMethods = isObject(raw["x-auth-methods"]) ? raw["x-auth-methods"] : {};
  const recordedMethod = Object.keys(authMethods)[0];
  return {
    framework,
    rendererId: readRendererId(config),
    issuer: await resolveIssuer(cwd, config, framework),
    server: typeof config.server === "string" ? config.server : "",
    project: {
      id: secret.project_id,
      projectSecret: secret.project_secret,
      previewSecret: secret.preview_secret,
      previewOrigins: secret.preview_origins,
      createdAt: secret.created_at,
    },
    userFields: Object.keys(properties),
    authMethod: isAuthMethod(recordedMethod) ? recordedMethod : "passkey",
    userSchema: raw as UserSchema,
  };
}

async function resolveIssuer(
  cwd: string,
  config: Record<string, unknown>,
  facts: FrameworkFacts,
): Promise<string> {
  const fromConfig = readDevelopmentIssuer(config);
  if (fromConfig && fromConfig.length > 0) {
    return fromConfig;
  }
  const state = await readState(cwd);
  if (typeof state?.dev_port === "number") {
    return issuerFromPort(state.dev_port);
  }
  return facts.issuerUrl;
}

async function readState(cwd: string): Promise<{ dev_port?: number } | undefined> {
  try {
    const contents = await readFile(join(cwd, ".zitadel/state.json"), "utf8");
    return JSON.parse(contents) as { dev_port?: number };
  } catch {
    return undefined;
  }
}

/** `zitadel doctor` — verify generated files and local state. */
export default class Doctor extends BaseCommand {
  static override description = "Verify generated files and local state.";
  static override flags = {
    fix: Flags.boolean({ description: "Re-apply missing managed files." }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Doctor);
    await this.toMeta(flags);
    return this.emit(await runDoctor({ ...this.meta, fix: flags.fix }));
  }
}
