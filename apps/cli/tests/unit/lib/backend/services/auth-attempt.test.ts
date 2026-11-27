import type { SetupServer } from "msw/node";
import { describe, expect } from "vitest";

import { it } from "@tests/fixtures";

import { AuthAttemptService } from "@/lib/backend/services/auth-attempt";
import { answering, type Reply, refusal, testClient } from "@tests/helpers/api-answers";

const ORIGIN = "http://localhost:8080";

/** A service on a test client, bound to the origin the attempt is made from. */
function service(): AuthAttemptService {
  return new AuthAttemptService(testClient(), ORIGIN);
}

describe("AuthAttemptService.open", () => {
  it("answers the attempt the server opened", async ({ server }) => {
    answering(server, "createAuthAttempt", { attempt_id: "att_1" });

    await expect(service().open("proj_1")).resolves.toBe("att_1");
  });

  it("names the origin the attempt is made from", async ({ server }) => {
    const opened = answering(server, "createAuthAttempt", { attempt_id: "att_1" });

    await service().open("proj_1");

    expect(
      opened.map(({ body, headers }) => {
        return [body, headers.get("origin")];
      }),
    ).toEqual([[{ project_id: "proj_1" }, ORIGIN]]);
  });
});

describe("AuthAttemptService.prove", () => {
  /** An attempt whose challenge is issued, and whose proof is answered by `verify`. */
  function proving(server: SetupServer, verify: Reply<"verifyAuthAttemptChallenge">) {
    answering(server, "createAuthAttemptChallenge", { challenge_id: "chl_1" });
    answering(server, "verifyAuthAttemptChallenge", verify);
    return service();
  }

  it("answers a proof the server accepted", async ({ server }) => {
    await expect(
      proving(server, { attempt_id: "att_1" }).prove("att_1", "password", {
        password: "hunter2",
      }),
    ).resolves.toEqual({ outcome: "proved" });
  });

  it("issues the challenge for the factor and answers that same challenge", async ({ server }) => {
    const issued = answering(server, "createAuthAttemptChallenge", { challenge_id: "chl_1" });
    const verified = answering(server, "verifyAuthAttemptChallenge", { attempt_id: "att_1" });

    await service().prove("att_1", "identifier", {
      login_name: "ada@acme.com",
    });

    expect(
      issued.map(({ params, body, headers }) => {
        return [params.attempt_id, body, headers.get("origin")];
      }),
    ).toEqual([["att_1", { method: "identifier" }, ORIGIN]]);
    expect(
      verified.map(({ params, body, headers }) => {
        return [params.attempt_id, params.challenge_id, body, headers.get("origin")];
      }),
    ).toEqual([["att_1", "chl_1", { login_name: "ada@acme.com" }, ORIGIN]]);
  });

  it("answers a rejected proof as an outcome, carrying the server's failure", async ({
    server,
  }) => {
    await expect(
      proving(server, refusal(401, "att.proof_rejected")).prove("att_1", "password", {
        password: "wrong",
      }),
    ).resolves.toMatchObject({
      outcome: "rejected",
      cause: { status: 401, body: { code: "att.proof_rejected" } },
    });
  });

  it("raises any failure that is not a rejected proof", async ({ server }) => {
    await expect(
      proving(server, refusal(500, "internal")).prove("att_1", "password", {
        password: "hunter2",
      }),
    ).rejects.toMatchObject({ status: 500 });
  });
});

describe("AuthAttemptService.handoff", () => {
  it("answers the one-time token the attempt ended with", async ({ server }) => {
    const handedOff = answering(server, "createAuthAttemptHandoff", { handoff_token: "ho_1" });

    await expect(service().handoff("att_1")).resolves.toBe("ho_1");
    expect(
      handedOff.map(({ params, headers }) => {
        return [params.attempt_id, headers.get("origin")];
      }),
    ).toEqual([["att_1", ORIGIN]]);
  });
});
