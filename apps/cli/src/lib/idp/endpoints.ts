import { text } from "@clack/prompts";

import { catalogIssuer, derivedEndpoints, type ConnectionEndpoints } from "@zitadel/config/idp-catalog";

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
  /** Turns a clack cancellation into whatever the caller raises. */
  readonly bail: <T>(value: T | symbol) => asserts value is T;
}): Promise<ConnectionEndpoints | undefined> {
  const { provider, developmentBuild, bail } = options;
  if (!developmentBuild) {
    return undefined;
  }
  const vendor = catalogIssuer(provider);
  const issuer = await askUrl("Issuer", vendor, bail);
  if (issuer === vendor) {
    // Nothing is being stood in for, so the endpoints are the vendor's and
    // come from its discovery document. Asking would offer two defaults that
    // are wrong for it -- Google's are not `<issuer>/authorize` and
    // `<issuer>/token` -- and every answer would be discarded anyway.
    return { issuer };
  }
  // The vendor's own paths on the stand-in's origin: a stand-in should answer
  // where the provider answers and differ only in where it is hosted, so the
  // default needs confirming rather than correcting.
  const derived = derivedEndpoints(issuer, provider);
  return {
    issuer,
    authorizationEndpoint: await askUrl(
      "Authorization endpoint",
      derived.authorizationEndpoint,
      bail,
    ),
    tokenEndpoint: await askUrl("Token endpoint", derived.tokenEndpoint, bail),
  };
}

/** One URL question, pre-filled with the answer that needs no thought. */
async function askUrl(
  message: string,
  initialValue: string,
  bail: <T>(value: T | symbol) => asserts value is T,
): Promise<string> {
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
  bail(answer);
  return String(answer).trim();
}
