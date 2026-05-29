import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { Flags } from "@oclif/core";

import { BaseCommand, type JsonEnvelope } from "../../lib/oclif";
import { ZitadelError } from "../../lib/errors";
import { isAuthMethod } from "../../lib/flows";
import { isObject } from "../../lib/json";
import { createOrca, issuerFromPort, type FrameworkFacts, type Orca } from "../../lib/orca";
import type { PatchContext } from "../../lib/orca/patchers/types";
import type { UserSchema } from "../../lib/user-schema";
import { readDevelopmentIssuer, readRendererId, readZitadelConfig, readZitadelSecret } from "../../lib/project";
import { SANITY_CHECKS } from "./checks";

async function applyFixes(cwd: string, dryRun: boolean, orca: Orca): Promise<void> {
  const ctx = await loadPatchContext(cwd, orca);
  // `repair` reclaims the managed artifacts — env files, gitignore, the SDK
  // dependency, and marker-bearing routes/middleware — even when locally edited,
  // while leaving the user-editable `.zitadel/` resource files untouched.
  await orca
    .patcherFor(ctx.framework.id)
    .repair(ctx, { cwd, dryRun, force: true });
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

/**
 * `zitadel doctor` — verify generated files and local state.
 *
 * Runs every registered {@link SANITY_CHECKS} entry and emits the aggregate
 * result; if any check fails it throws `E_VALIDATION` carrying the full check
 * details. With `--fix`, it re-applies the managed scaffold first (reclaiming
 * managed files, even locally edited ones) before running the checks.
 */
export default class Doctor extends BaseCommand {
  static override description = "Verify generated files and local state.";
  static override flags = {
    fix: Flags.boolean({ description: "Re-apply missing managed files." }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Doctor);
    await this.toMeta(flags);
    const { cwd, dryRun } = this.meta;

    const orca = createOrca();
    if (flags.fix) {
      await applyFixes(cwd, dryRun, orca);
    }

    const checks = await Promise.all(SANITY_CHECKS.map((check) => check.run({ cwd, orca })));
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

    return this.emit({ status: "ok", data });
  }
}
