import type { PatchContext } from "@/lib/orca/patchers/types";
import { CliPackage } from "@/lib/upgrade";

/**
 * What a patcher plans from, for `framework`, with a project and the local
 * addresses setup would have found.
 *
 * @param framework - The framework id the patcher answers to.
 * @param overrides - Only what the test is about.
 * @returns The context.
 */
export function aPatchContext(
  framework: string,
  overrides: Partial<PatchContext> = {},
): PatchContext {
  const cliVersion = overrides.cliVersion ?? "0.1.0";
  return {
    framework: { id: framework, appDir: "app", devPort: 3000, url: "http://localhost:3000" },
    rendererId: "react",
    project: {
      id: "proj-1",
      project_secret: "sk_full",
      preview_secret: "sk_preview",
      origins: [],
      created_at: "2026-01-01T00:00:00.000Z",
    },
    issuer: "http://localhost:3000",
    server: "http://localhost:8080",
    cliVersion,
    sdkVersion: CliPackage.at(cliVersion).selector(),
    ...overrides,
  };
}
