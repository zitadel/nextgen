import { Consent } from "../../src/lib/consent";

/** The consent `--force` gives, for a unit test that drives a destructive operation directly. */
export async function forcedConsent(): Promise<Consent> {
  const consent = await Consent.request(
    { verb: "delete", name: "delete it", message: "Delete it?" },
    { interactive: false, force: true, dryRun: false },
  );
  if (consent === undefined) {
    throw new Error("--force gave no consent");
  }
  return consent;
}
