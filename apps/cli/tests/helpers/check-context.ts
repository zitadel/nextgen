import type { CheckContext } from "@/commands/doctor/checks";
import { Consent } from "@/lib/consent";
import { createOrca } from "@/lib/orca";
import { asEnvironmentSelector } from "@/lib/suggestion";

/**
 * The CLI version a doctor check runs as unless a test says otherwise.
 */
export const CHECK_CLI_VERSION = "0.1.0-alpha.0";

/**
 * Consent as `--force` gives it: every destructive repair is allowed.
 *
 * @param dryRun - Whether the run previews only.
 * @returns The consent function.
 */
export function forced(dryRun = false): CheckContext["consent"] {
  return (gate) => {
    return Consent.request(gate, { interactive: false, force: true, dryRun });
  };
}

/**
 * Consent a person withholds: every destructive repair is declined.
 *
 * @returns Nothing, which is a no.
 */
export async function declined(): Promise<undefined> {
  return undefined;
}

/**
 * Consent no repair may ask for: a check whose repairs remove nothing fails
 * the test if it asks.
 *
 * @param gate - What the repair asked consent for.
 * @returns Never; it always rejects.
 */
async function unasked(gate: Parameters<CheckContext["consent"]>[0]): Promise<never> {
  throw new Error(`unexpected request to ${gate.name}`);
}

/**
 * The context a doctor check runs in: the project at `cwd`, a real run that
 * asks no consent.
 *
 * @param cwd - The project directory.
 * @param overrides - Fields to set in place of the defaults.
 * @returns The context.
 */
export function aCheckContext(cwd: string, overrides: Partial<CheckContext> = {}): CheckContext {
  return {
    cwd,
    orca: createOrca(),
    cliVersion: CHECK_CLI_VERSION,
    selector: asEnvironmentSelector(""),
    dryRun: false,
    signal: new AbortController().signal,
    consent: unasked,
    ...overrides,
  };
}
