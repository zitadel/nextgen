import {
  type CatalogProviderId,
  type ConnectionEndpoints,
  idpProvider,
  parseIssuer,
} from "@zitadel/config/idp";

import type { Asker } from "../input";

/**
 * Ask where a provider lives, on a development run only.
 *
 * Someone working on the CLI runs it against a local stand-in constantly, and
 * before this the connection document had to be hand-edited afterwards and
 * re-applied. Someone who installed the CLI is configuring the real vendor and
 * must never meet the question — so it is gated on `developmentBuild`
 * (`isDevelopmentBuild()`, the explicit `ZITADEL_CLI_DEV` opt-in). A published
 * CLI never sets it, so the question stays out of its `--help` and prompts.
 *
 * Returns `undefined` for a normal run and for a scripted run, and the
 * catalog's own issuer is dropped when written, so an ordinary run produces
 * the document it would if none of this existed.
 */
export async function askConnectionEndpoints(options: {
  readonly provider: CatalogProviderId;
  readonly developmentBuild: boolean;
  /** How the question is asked: the running command's `input`. */
  readonly ask: Asker;
}): Promise<ConnectionEndpoints | undefined> {
  const { provider, developmentBuild, ask } = options;
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
  // Validated against the connection contract rather than merely parsed: `new
  // URL` accepts `http://idp.internal:9100` and `file:///tmp/idp`, which would
  // be written to a connection that then fails on apply. Refusing at the prompt
  // puts the complaint where the value was typed.
  return {
    issuer: await ask({
      kind: "text",
      name: "issuer",
      message: "Issuer",
      parse: parseIssuer,
      initialValue: idpProvider(provider).issuer,
    }),
  };
}
