import type { SetupServices } from "@/cli/commands/setup/shared";
import { asker } from "@/lib/input";
import { Ui } from "@/lib/ui";
import { write } from "@tests/helpers/git-repo";
import { parseJson } from "@tests/helpers/run-cli";
import { aSuggest } from "@tests/helpers/suggestions";

/**
 * Writes a Next.js App Router app setup detects, with no Zitadel files yet.
 *
 * @param cwd - The directory to write it into.
 * @param packageJson - Keys to set in its `package.json` beside the name and
 *   the `next` dependency, such as `scripts`.
 * @returns Once the files are written.
 */
export async function aNextApp(
  cwd: string,
  packageJson: Record<string, unknown> = {},
): Promise<void> {
  await write(cwd, {
    "package.json": JSON.stringify({ name: "demo", dependencies: { next: "^16" }, ...packageJson }),
    "app/layout.tsx": "export default function Layout() {}\n",
  });
}

/**
 * The commands a `--json` envelope suggests, in order: under `data` for a
 * success, at the root for a refusal. Anything else reads as none.
 *
 * @param stdout - What the run printed to stdout.
 * @returns The suggested commands.
 */
export function suggestedCommands(stdout: string): string[] {
  const envelope = parseJson(stdout);
  if (typeof envelope !== "object" || envelope === null) {
    return [];
  }
  const holder = "data" in envelope && typeof envelope.data === "object" ? envelope.data : envelope;
  if (holder === null || !("next_commands" in holder) || !Array.isArray(holder.next_commands)) {
    return [];
  }
  return holder.next_commands.filter((command): command is string => {
    return typeof command === "string";
  });
}

/**
 * What the wizard's prompt steps are constructed with: an interactive run in
 * the app directory, as setup builds it.
 *
 * @param cwd - The project's directory.
 * @returns The services those steps take.
 */
export function aPromptDeps(
  cwd = "/tmp/app",
): Pick<
  SetupServices,
  "ask" | "cwd" | "dryRun" | "nonInteractive" | "serverFlag" | "suggest" | "ui"
> {
  const audience = { interactive: true, force: false };
  return {
    ask: asker(audience),
    cwd,
    dryRun: false,
    nonInteractive: false,
    serverFlag: undefined,
    suggest: aSuggest({}, "1.2.3"),
    ui: new Ui(audience),
  };
}
