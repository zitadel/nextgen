import { text } from "@clack/prompts";

import { idpProvider, type ConnectionEndpoints } from "@zitadel/config/idp";

import { bailOnCancel } from "../prompt-cancel";

/**
 * Ask where a provider lives, on a development build only.
 *
 * Someone working on the CLI runs it against a local stand-in constantly, and
 * before this the connection document had to be hand-edited afterwards and
 * re-applied. Someone who installed the CLI is configuring the real vendor and
 * must never meet the question — which is why the gate is the build stamp
 * rather than a flag. A flag would have to be typed by exactly the people who
 * should not need to know it exists, and would sit in `--help` output and
 * shell history belonging to everyone else.
 *
 * Returns `undefined` for a released build and for a scripted run, and the
 * catalog's own issuer is dropped when written, so an ordinary run produces
 * the document it would if none of this existed.
 */
export async function askConnectionEndpoints(options: {
  readonly provider: string;
  readonly developmentBuild: boolean;
  /** The command being cancelled, for the wording a Ctrl-C produces. */
  readonly command: string;
}): Promise<ConnectionEndpoints | undefined> {
  const { provider, developmentBuild, command } = options;
  if (!developmentBuild) {
    return undefined;
  }
  // Only the issuer is asked for, and only the issuer is written. The engine
  // accepts a connection that names every endpoint or none at all
  // (`requireAllOrNoEndpoints`): naming two of the four it needs -- it also
  // wants `jwks_uri`, and `userinfo_endpoint` unless id_token mapping is on --
  // is rejected as `idp.endpoints_partial`. Asking for four URLs to satisfy
  // that would be a worse question than asking for none, and a stand-in
  // serves its own discovery document just as the vendor does.
  return { issuer: await askUrl("Issuer", idpProvider(provider).issuer, command) };
}

/** One URL question, pre-filled with the answer that needs no thought. */
async function askUrl(message: string, initialValue: string, command: string): Promise<string> {
  const answer = await text({
    message,
    initialValue,
    validate: (value) => {
      try {
        new URL(String(value ?? ""));
        return undefined;
      } catch {
        return "Enter an absolute URL, e.g. http://localhost:9100.";
      }
    },
  });
  bailOnCancel(answer, command);
  return String(answer).trim();
}
