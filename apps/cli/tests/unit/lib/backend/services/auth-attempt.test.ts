import { describe, expect, it, vi } from "vitest";

import { BackendError } from "@/lib/backend/errors";
import { AuthAttemptService } from "@/lib/backend/services/auth-attempt";
import { type ClientStubs, fakeClient } from "@tests/helpers/fake-client";

const ORIGIN = "http://localhost:8080";

/** The headers the server checks an attempt against. */
const FROM_ORIGIN = { headers: { origin: ORIGIN } };

/** A service answering `stubs`, bound to the origin the attempt is made from. */
function service(stubs: ClientStubs): AuthAttemptService {
  return new AuthAttemptService(fakeClient(stubs), ORIGIN);
}

describe("AuthAttemptService.open", () => {
  it("answers the attempt the server opened", async () => {
    const createAuthAttempt = vi.fn(async () => ({ attempt_id: "att_1" }));

    await expect(service({ createAuthAttempt }).open("proj_1")).resolves.toBe("att_1");
  });

  it("names the origin the attempt is made from", async () => {
    const createAuthAttempt = vi.fn(async () => ({ attempt_id: "att_1" }));

    await service({ createAuthAttempt }).open("proj_1");

    expect(createAuthAttempt).toHaveBeenCalledWith({ project_id: "proj_1" }, FROM_ORIGIN);
  });
});

describe("AuthAttemptService.prove", () => {
  /** An attempt whose proof is answered by `verify`. */
  function proving(verify: () => Promise<{ attempt_id?: string }>) {
    return service({
      createAuthAttemptChallenge: async () => ({ challenge_id: "chl_1" }),
      verifyAuthAttemptChallenge: verify,
    });
  }

  it("answers a proof the server accepted", async () => {
    await expect(
      proving(async () => ({ attempt_id: "att_1" })).prove("att_1", "password", {
        password: "hunter2",
      }),
    ).resolves.toEqual({ outcome: "proved" });
  });

  it("issues the challenge for the factor and answers that same challenge", async () => {
    const createAuthAttemptChallenge = vi.fn(async () => ({ challenge_id: "chl_1" }));
    const verifyAuthAttemptChallenge = vi.fn(async () => ({ attempt_id: "att_1" }));

    await service({ createAuthAttemptChallenge, verifyAuthAttemptChallenge }).prove(
      "att_1",
      "identifier",
      {
        login_name: "ada@acme.com",
      },
    );

    expect(createAuthAttemptChallenge).toHaveBeenCalledWith(
      "att_1",
      { method: "identifier" },
      FROM_ORIGIN,
    );
    expect(verifyAuthAttemptChallenge).toHaveBeenCalledWith(
      "att_1",
      "chl_1",
      { login_name: "ada@acme.com" },
      FROM_ORIGIN,
    );
  });

  it("answers a rejected proof as an outcome, carrying the server's failure", async () => {
    const cause = new BackendError("refused", {
      status: 401,
      body: { code: "att.proof_rejected" },
    });

    await expect(
      proving(async () => {
        throw cause;
      }).prove("att_1", "password", { password: "wrong" }),
    ).resolves.toEqual({ outcome: "rejected", cause });
  });

  it("raises any failure that is not a rejected proof", async () => {
    await expect(
      proving(async () => {
        throw new BackendError("broken", { status: 500 });
      }).prove("att_1", "password", { password: "hunter2" }),
    ).rejects.toMatchObject({ status: 500 });
  });
});

describe("AuthAttemptService.handoff", () => {
  it("answers the one-time token the attempt ended with", async () => {
    const createAuthAttemptHandoff = vi.fn(async () => ({ handoff_token: "ho_1" }));

    await expect(service({ createAuthAttemptHandoff }).handoff("att_1")).resolves.toBe("ho_1");
    expect(createAuthAttemptHandoff).toHaveBeenCalledWith("att_1", FROM_ORIGIN);
  });
});
