import type { VerifyChallengeProofBody } from "@zitadel/api/generated/model";

import { ApiService } from "@/lib/backend/api-service";
import type { ZitadelClient } from "@/lib/backend/client";
import { BackendError } from "@/lib/backend/errors";

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
      cause: BackendError;
    }
>;

/**
 * Signing in without a browser: opening an auth attempt, proving its factors,
 * and taking the one-time token it ends with.
 *
 * @remarks
 * A Service Layer (Fowler, PoEAA) over the generated API client, which plays
 * the Gateway: a command says what should happen and never which endpoint
 * serves it. Bound to the origin the attempt is made from, which the server
 * checks the attempt against, so a call carries only what is specific to it.
 */
export class AuthAttemptService extends ApiService {
  private readonly origin: string;

  /**
   * Bind the service to a client and the origin every request names.
   *
   * @param client - The client every call goes through.
   * @param origin - The origin the attempt is made from: the server's own.
   */
  constructor(client: ZitadelClient, origin: string) {
    super(client);
    this.origin = origin;
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
      this.request(),
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
   * @throws BackendError for any failure that is not a rejected proof.
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
      this.request(),
    );
    try {
      await this.client.verifyChallengeProof(
        attemptId,
        challenge.challenge_id,
        proof,
        this.request(),
      );
      return {
        outcome: "proved",
      };
    } catch (error) {
      if (error instanceof BackendError && error.serverCode === "att.proof_rejected") {
        return {
          outcome: "rejected",
          cause: error,
        };
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
    const handoff = await this.client.createHandoff(attemptId, this.request());
    return handoff.handoff_token;
  }

  /**
   * The headers every request of an attempt carries.
   *
   * @returns The request options naming the origin.
   */
  private request(): {
    headers: {
      origin: string;
    };
  } {
    return {
      headers: {
        origin: this.origin,
      },
    };
  }
}
