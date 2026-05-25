import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { stableStringify } from "../../../json";
import { DEFAULT_SERVER } from "../../../../platform/resolve-server";
import { scaffold } from "../legacy/file-writer";
import { buildFlowDefinition, buildLocaleSeed } from "../legacy";
import type { ScaffoldPlan, ScaffoldResult } from "../legacy/file-writer/plan";
import type { PatchContext, Patcher } from "../types";

const GATEWAY_URL = "https://zitadel-llmgateway.vercel.app";
const GATEWAY_PLACEHOLDER_TOKEN = "zitadel-gateway-placeholder";
const AGENT_MODEL = "claude-sonnet-4-20250514";
const MAX_RETRIES = 2;

/**
 * Returns whether the given tool call is permitted within the Nuxt integration
 * sandbox. Non-Bash tools are always allowed. For Bash, only package-manager
 * add/install commands and `tsc --noEmit` are permitted.
 */
export function nuxtCanUseTool(
  toolName: string,
  input: Record<string, unknown>,
): { behavior: "allow" | "deny"; message?: string; updatedInput?: Record<string, unknown> } {
  if (toolName !== "Bash") {
    return { behavior: "allow", updatedInput: input };
  }

  const command = (typeof input.command === "string" ? input.command : "").trim();

  const allowed =
    command.startsWith("pnpm add ") ||
    command.startsWith("npm install ") ||
    command.startsWith("yarn add ") ||
    command.startsWith("bun add ") ||
    command === "tsc --noEmit";

  if (allowed) {
    return { behavior: "allow", updatedInput: input };
  }

  return {
    behavior: "deny",
    message: `Bash command not allowed in the Nuxt integration sandbox. Only package-manager add/install and "tsc --noEmit" are permitted. Got: ${command}`,
  };
}

/**
 * LLM-based patcher for Nuxt projects.
 *
 * Drives the Claude Agent SDK with inline skill files to integrate the Zitadel
 * authentication SDK into an existing Nuxt application. Base config files are
 * written deterministically before the agent runs; the agent handles
 * framework-specific code (nuxt.config.ts edits, Vue SFC pages).
 */
export class LLMPatcher implements Patcher {
  /** Returns true for Nuxt projects. */
  canPatch(framework: string): boolean {
    return framework === "nuxt";
  }

  /**
   * Applies the Zitadel integration to the Nuxt project in three steps:
   * 1. Write base config files deterministically (.zitadel/ tree, env files).
   * 2. Run the AI agent with framework-specific skill instructions.
   * 3. Validate with `tsc --noEmit`, retrying the agent on TypeScript errors.
   */
  async patch(ctx: PatchContext): Promise<ScaffoldResult> {
    const baseResult = await this.writeBaseFiles(ctx);
    await this.runAgent(ctx);
    return {
      dryRun: ctx.dryRun,
      filesWritten: baseResult.filesWritten,
      filesSkipped: baseResult.filesSkipped,
      depsAdded: ["@zitadel-nextgen/sdk-nuxt"],
    };
  }

  /**
   * Writes the deterministic base files — the .zitadel/ directory tree, env
   * files, and state — before the agent runs. Nuxt uses NEXTGEN_ISSUER_URL
   * as its primary auth configuration env var.
   */
  private async writeBaseFiles(ctx: PatchContext): Promise<ScaffoldResult> {
    const flow = buildFlowDefinition(ctx.userFields, ctx.authMethods);
    const locale = buildLocaleSeed(ctx.userFields, ctx.authMethods);

    const plan: ScaffoldPlan = {
      ops: [
        { kind: "mkdir", path: ".zitadel", mode: 0o700 },
        { kind: "mkdir", path: ".zitadel/flows" },
        { kind: "mkdir", path: ".zitadel/schemas" },
        { kind: "mkdir", path: ".zitadel/locales" },
        {
          kind: "append-gitignore",
          entries: [".zitadel/secret", ".env*", "!.env.example"],
        },
        {
          kind: "write",
          path: ".zitadel/secret",
          mode: 0o600,
          contents: `${stableStringify({
            project_id: ctx.project.id,
            project_secret: ctx.project.projectSecret,
            preview_secret: ctx.project.previewSecret,
            preview_origins: ctx.project.previewOrigins,
            created_at: ctx.project.createdAt,
          })}\n`,
        },
        {
          kind: "write",
          path: "zitadel.json",
          contents: `${stableStringify(buildProjectConfig(ctx))}\n`,
        },
        {
          kind: "write",
          path: ".zitadel/schemas/user.json",
          contents: `${stableStringify(ctx.userSchema)}\n`,
        },
        {
          kind: "write",
          path: ".zitadel/flows/default.json",
          contents: `${stableStringify(flow)}\n`,
        },
        {
          kind: "write",
          path: ".zitadel/locales/en.json",
          contents: `${stableStringify(locale)}\n`,
        },
        {
          kind: "merge-env",
          path: ".env.example",
          entries: {
            NEXTGEN_ISSUER_URL: "",
            ZITADEL_PROJECT_ID: "",
            ZITADEL_ENVIRONMENT: "",
            ZITADEL_ISSUER: "",
          },
        },
        {
          kind: "merge-env",
          path: ".env.local",
          entries: {
            NEXTGEN_ISSUER_URL: ctx.issuer,
            ZITADEL_PROJECT_ID: ctx.project.id,
            ZITADEL_ENVIRONMENT: "development",
            ZITADEL_ISSUER: ctx.issuer,
          },
        },
        {
          kind: "write",
          path: ".zitadel/state.json",
          contents: `${stableStringify({
            framework: "nuxt",
            resources: {},
          })}\n`,
        },
      ],
      summary: [
        {
          title: "Zitadel config",
          detail: "Created local config, schema, flows, env, and secret files.",
        },
      ],
    };

    return scaffold(plan, { cwd: ctx.cwd, dryRun: ctx.dryRun, force: ctx.force });
  }

  /**
   * Runs the Claude Agent SDK against the Nuxt project using inline skill
   * files. Retries up to MAX_RETRIES times when `tsc --noEmit` reports errors.
   * No-ops in dry-run mode.
   */
  private async runAgent(ctx: PatchContext): Promise<void> {
    if (ctx.dryRun) {
      return;
    }

    const skillsDir = join(dirname(fileURLToPath(import.meta.url)), "skills");
    const baseSkill = readFileSync(join(skillsDir, "base.md"), "utf8");
    const frameworkSkill = readFileSync(join(skillsDir, "nuxt.md"), "utf8");
    const initialPrompt = buildAgentPrompt(ctx, baseSkill, frameworkSkill);

    const sdkEnv: Record<string, string | undefined> = {
      ...process.env,
      ANTHROPIC_BASE_URL: GATEWAY_URL,
      ANTHROPIC_AUTH_TOKEN: GATEWAY_PLACEHOLDER_TOKEN,
      CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "true",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "true",
    };
    delete sdkEnv["ANTHROPIC_API_KEY"];

    const sdk = await import("@anthropic-ai/claude-agent-sdk");

    let tsErrors = "";
    let retryCount = 0;

    while (retryCount <= MAX_RETRIES) {
      const turnContent =
        retryCount === 0 ? initialPrompt : buildCorrectionPrompt(tsErrors);

      const response = sdk.query({
        prompt: (async function* () {
          yield {
            type: "user" as const,
            session_id: "",
            message: { role: "user" as const, content: turnContent },
            parent_tool_use_id: null,
          };
        })(),
        options: {
          model: AGENT_MODEL,
          cwd: ctx.cwd,
          permissionMode: "acceptEdits" as const,
          env: sdkEnv,
          canUseTool: (toolName: string, input: Record<string, unknown>) =>
            Promise.resolve(nuxtCanUseTool(toolName, input)),
          tools: { type: "preset" as const, preset: "claude_code" as const },
          allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
        },
      });

      for await (const _message of response) {
        // Consume all messages from the current agent turn.
      }

      const localTsc = join(ctx.cwd, "node_modules", ".bin", "tsc");
      if (!existsSync(join(ctx.cwd, "tsconfig.json")) || !existsSync(localTsc)) {
        break;
      }

      const tsResult = spawnSync(localTsc, ["--noEmit"], {
        cwd: ctx.cwd,
        encoding: "utf8",
      });

      if (tsResult.status === 0) {
        break;
      }

      const tsOutput = String(
        (tsResult.stderr !== null && tsResult.stderr !== ""
          ? tsResult.stderr
          : tsResult.stdout) ?? "unknown TypeScript errors",
      );

      if (retryCount === MAX_RETRIES) {
        throw new Error(
          `TypeScript validation failed after ${MAX_RETRIES} retries:\n${tsOutput}`,
        );
      }

      tsErrors = tsOutput;
      retryCount++;
    }
  }
}

function buildAgentPrompt(ctx: PatchContext, baseSkill: string, frameworkSkill: string): string {
  return `${baseSkill}

---

${frameworkSkill}

---

## Project context

- Framework: Nuxt
- TypeScript: yes
- Package manager: ${ctx.packageManager}
- Project ID: ${ctx.project.id}
- Issuer: ${ctx.issuer}
- Server: ${ctx.server}

The following environment variables are already written to \`.env.local\`:
- NEXTGEN_ISSUER_URL
- ZITADEL_PROJECT_ID
- ZITADEL_ENVIRONMENT
- ZITADEL_ISSUER

Begin integration now.`;
}

function buildCorrectionPrompt(tsErrors: string): string {
  return `The TypeScript compiler reported errors after your changes. Please fix them.

\`\`\`
${tsErrors}
\`\`\`

Apply the fixes and ensure the project compiles cleanly.`;
}

function buildProjectConfig(ctx: PatchContext): Record<string, unknown> {
  const environments: Record<string, unknown> = {
    development: { issuer: ctx.issuer },
  };

  if (ctx.project.previewOrigins.length > 0) {
    environments.preview = {
      issuer_pattern: ctx.project.previewOrigins.map((origin) => `https://${origin}`),
    };
  }

  const server = resolveServer(ctx.server);

  return {
    $schema: "https://schemas.zitadel.com/v2/project.schema.json",
    project: ctx.project.id,
    server,
    framework: { id: "nuxt" },
    branding: {
      renderer: ctx.rendererId,
      attribution: "visible",
    },
    environments,
  };
}

function resolveServer(source: string): string {
  try {
    return new URL(source).origin;
  } catch {
    return DEFAULT_SERVER;
  }
}
