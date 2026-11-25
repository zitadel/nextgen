import { Asker } from "@/cli/core";
import { Consent, type ConsentSession } from "@/lib/consent";

/**
 * A consent session whose question is answered the way a command's is: by
 * `--force` or by the person at the terminal, and refused when nobody can say.
 *
 * @param session - Who can answer, and whether the run may change anything.
 * @returns The session, with its confirmer.
 */
export function aConsentSession(session: Omit<ConsentSession, "confirmer">): ConsentSession {
  return { ...session, confirmer: Asker.for(session) };
}

/** The consent `--force` gives, for a unit test that drives a destructive operation directly. */
export async function forcedConsent(): Promise<Consent> {
  const consent = await Consent.request(
    { verb: "delete", name: "delete it", message: "Delete it?" },
    aConsentSession({ interactive: false, force: true, dryRun: false }),
  );
  if (consent === undefined) {
    throw new Error("--force gave no consent");
  }
  return consent;
}
