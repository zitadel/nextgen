import type { HttpResponse, ProviderProbes, Verdict } from "./context";

const UNKNOWN: Verdict = { kind: "unknown" };

/** Where Google sends a request it accepts, when nobody is signed in. */
const SIGN_IN_PAGE = "/v3/signin/identifier";

/**
 * Google's wording, read off its live endpoints: an unregistered redirect URI
 * and an unknown client both end on an error page whose URL names the cause in
 * `authError`, and a good request ends on a sign-in page. A token request with a made-up code
 * answers `invalid_grant` once the client and secret are accepted, and
 * `invalid_client` when either is not.
 */
export const GOOGLE_PROBES: ProviderProbes = {
  authorize({ status, url }: HttpResponse): Verdict {
    const { hostname, pathname, searchParams } = new URL(url);
    const refusal = Buffer.from(searchParams.get("authError") ?? "", "base64url").toString(
      "latin1",
    );
    if (refusal.includes("redirect_uri_mismatch")) {
      return {
        kind: "rejected",
        problem: "redirect_uri",
        reason: "Google rejected the callback URI (redirect_uri_mismatch)",
      };
    }
    if (refusal.includes("invalid_client")) {
      return {
        kind: "rejected",
        problem: "client",
        reason: "Google does not know this client ID (invalid_client)",
      };
    }
    return status === 200 && hostname === "accounts.google.com" && pathname === SIGN_IN_PAGE
      ? { kind: "accepted" }
      : UNKNOWN;
  },

  token({ body }: HttpResponse): Verdict {
    let answer: { error?: string; error_description?: string };
    try {
      answer = JSON.parse(body) as typeof answer;
    } catch {
      return UNKNOWN;
    }
    if (answer.error === "invalid_grant") {
      return { kind: "accepted" };
    }
    if (answer.error !== "invalid_client") {
      return UNKNOWN;
    }
    return /not found/i.test(answer.error_description ?? "")
      ? {
          kind: "rejected",
          problem: "client",
          reason: "Google does not know this client ID (invalid_client)",
        }
      : {
          kind: "rejected",
          problem: "secret",
          reason: "Google rejected the client secret (invalid_client)",
        };
  },
};
