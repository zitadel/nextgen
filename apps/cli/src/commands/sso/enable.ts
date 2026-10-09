import type { GlobalOptions } from "../../lib/oclif/types";
import { reportWarning } from "../../lib/warnings";
import AuthMethodSsoEnable from "../auth-method/sso/enable";

/**
 * `sso enable`, kept as a deprecated alias of `auth-method sso enable`
 * (ADR 069 §6). It takes the same flags and does the same thing; removing it
 * is a separate change.
 */
export default class SsoEnable extends AuthMethodSsoEnable {
  static override description = "Deprecated alias of auth-method sso enable.";
  static override examples = ["<%= config.bin %> auth-method sso enable --provider google"];

  /**
   * Said once the invocation is set up rather than at the start of `run`:
   * `--json` silences the terminal in `toMeta`, so warning earlier would print
   * a stray line on stderr, and only now does the warning reach both readers.
   */
  protected override async toMeta(
    flags: Record<string, unknown>,
    options?: { resolveServer?: boolean; source?: string },
  ): Promise<GlobalOptions> {
    const meta = await super.toMeta(flags, options);
    reportWarning(
      "`sso enable` is deprecated. Use `auth-method sso enable`, which takes the same flags.",
    );
    return meta;
  }
}
