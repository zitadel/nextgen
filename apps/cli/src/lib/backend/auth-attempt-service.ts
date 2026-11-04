import type { VerifyChallengeProofBody } from "@zitadel/api/generated/model";
import { ApiError } from "@zitadel/api/runtime/fetch";

import type { ZitadelClient } from "../gateway/client";

/** How one request is made: its headers and its abort signal. */
export type AttemptRequestOptions = Parameters<ZitadelClient["createAuthAttempt"]>[1];

/** The factors an attempt can be asked to prove. */
export type AttemptFactor = "identifier" | "password";

/** What answers a challenge: the identifier or the password. */
export type AttemptProof = Readonly<VerifyChallengeProofBody>;

/**
 * What proving a factor came to. `rejected` carries the error the server
 * answered with, so a caller that has nothing better to say can throw it.
 */
export type AttemptProofResult = Readonly<
  | {
      outcome: "proved";
    }
  | {
      outcome: "rejected";
      cause: ApiError;
    }
>;

/**
 * Signing in without a browser: opening an auth attempt, proving its factors,
 * and taking the one-time token it ends with.
 *
 * @remarks
 * A Service Layer (Fowler, PoEAA) over the generated API client, which plays
 * the Gateway: a command says what should happen and never which endpoint
 * serves it. Bound to a client alone, with the way its requests are made, so a
 * call carries only what is specific to it. The options are a function because
 * a timeout starts when its signal is made and cannot be shared across calls.
 */
export class AuthAttemptService {
  private readonly client: ZitadelClient;
  private readonly options: () => AttemptRequestOptions;

  constructor(client: ZitadelClient, options: () => AttemptRequestOptions) {
    this.client = client;
    this.options = options;
  }

  /**
   * Open an attempt.
   *
   * @param projectId - The project the person is signing in to.
   * @returns The attempt's id.
   */
  async open(projectId: string): Promise<string> {
    const attempt = await this.client.createAuthAttempt(
      {
        project_id: projectId,
      },
      this.options(),
    );
    return attempt.attempt_id;
  }

  /**
   * Prove one factor. The proof must carry the challenge just issued: the
   * server rejects a proof against a re-issued challenge, so issuing and
   * answering belong together.
   *
   * @param attemptId - The attempt to prove it in.
   * @param factor - Which factor is being proved.
   * @param proof - The identifier or the password.
   * @returns Whether the server accepted the proof.
   * @throws ApiError for any failure that is not a rejected proof.
   */
  async prove(
    attemptId: string,
    factor: AttemptFactor,
    proof: AttemptProof,
  ): Promise<AttemptProofResult> {
    const challenge = await this.client.issueChallenge(
      attemptId,
      {
        method: factor,
      },
      this.options(),
    );
    try {
      await this.client.verifyChallengeProof(
        attemptId,
        challenge.challenge_id,
        proof,
        this.options(),
      );
      return Object.freeze({
        outcome: "proved",
      });
    } catch (error) {
      if (error instanceof ApiError && error.code === "att.proof_rejected") {
        return Object.freeze({
          outcome: "rejected",
          cause: error,
        });
      }
      throw error;
    }
  }

  /**
   * Take the one-time token an attempt ends with.
   *
   * @param attemptId - The attempt whose factors were all proved.
   * @returns The handoff token, which becomes a console link or a session.
   */
  async handoff(attemptId: string): Promise<string> {
    const handoff = await this.client.createHandoff(attemptId, this.options());
    return handoff.handoff_token;
  }
}
