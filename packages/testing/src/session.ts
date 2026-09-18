import type { ZitadelClient } from "@zitadel/api/client";
import type { VerifyChallengeProofBody } from "@zitadel/api/generated/model";

import type { SeedContext } from "./seed";
import type { InstanceHandle, MintedSession, SeededUser } from "./types";

/** Mirrors the server's session cookie (internal/api/session.go). */
export const SESSION_COOKIE_NAME = "__nextgen_session";

/**
 * The attribute a seeded user is identified by. `seedUser` writes the email as
 * the project-unique attribute, so that is the one an identifier proof names.
 */
const SEEDED_IDENTIFIER_ATTRIBUTE = "email";

export interface MintSessionOptions {
  /**
   * Origin header for the exchange, for projects whose allowlist is enforced
   * on it. The authentication calls themselves are not browser calls.
   */
  origin?: string;
}

/**
 * Authenticate a seeded password user and exchange the resulting handoff for a
 * session, through the auth-attempt API the login widget itself is built on:
 * create an attempt, prove the identifier, prove the password, hand off.
 *
 * This deliberately does not drive the project's login flow. A flow exists to
 * render steps to a human; a test kit has no human and already holds the
 * credentials, so it states them directly. That also keeps a seeded session
 * independent of how the project configures its login — a custom flow, an
 * extra branch, or a reordered step cannot break seeding.
 *
 * Users with more than a password are out of scope: the kit proves exactly the
 * identifier and password factors, and a project that requires another factor
 * fails at handoff rather than being silently signed in with less.
 */
export async function mintSession(
  client: ZitadelClient,
  _handle: Pick<InstanceHandle, "baseUrl" | "projectSecret">,
  context: SeedContext,
  user: SeededUser,
  options: MintSessionOptions = {},
): Promise<MintedSession> {
  const attempt = await client.createAuthAttempt({ project_id: context.projectId });

  await proveFactor(
    client,
    attempt.attempt_id,
    "identifier",
    { login_name: user.email, attribute_name: SEEDED_IDENTIFIER_ATTRIBUTE },
    user,
  );
  await proveFactor(client, attempt.attempt_id, "password", { password: user.password }, user);

  const { handoff_token } = await client.createHandoff(attempt.attempt_id);
  const exchanged = await client.exchangeHandoff(
    { handoff_token },
    { project_id: context.projectId },
    options.origin ? { headers: { origin: options.origin } } : undefined,
  );

  return {
    user,
    sessionToken: exchanged.session_token,
    expiresAt: exchanged.session.expires_at,
    cookie: {
      name: SESSION_COOKIE_NAME,
      value: exchanged.session_token,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
    },
  };
}

/**
 * Issue a challenge for one factor and answer it. The challenge id must be the
 * one just issued: the server rejects a proof against a re-issued challenge, so
 * the two calls belong together.
 */
async function proveFactor(
  client: ZitadelClient,
  attemptId: string,
  method: "identifier" | "password",
  proof: VerifyChallengeProofBody,
  user: SeededUser,
): Promise<void> {
  const challenge = await client.issueChallenge(attemptId, { method });
  try {
    await client.verifyChallengeProof(attemptId, challenge.challenge_id, proof);
  } catch (error) {
    throw new Error(
      `seed.session: the ${method} proof was rejected. ` +
        (method === "identifier"
          ? `No user is identified by ${SEEDED_IDENTIFIER_ATTRIBUTE} "${user.email}" in this project.`
          : "The seeded password did not verify.") +
        `\n${String(error)}`,
      { cause: error },
    );
  }
}
