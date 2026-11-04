import { describe, expect } from "vitest";

import Api, {
  credentialFor,
  type Held,
  holdsFor,
  readOperation,
  readProjectSecret,
  refuseUnforced,
  refuseUnpaged,
} from "../../../../src/commands/api/index";
import { it } from "../../../helpers/fixtures";
import { parseFlag } from "../../../helpers/inputs";
import { resolveTarget } from "../../../../src/lib/api/operations";
import type { ZitadelSecret } from "../../../../src/lib/project";
import { type SuggestedCommand, unscopedCommand } from "../../../../src/lib/suggestion";

describe("the operation zitadel api is pointed at", () => {
  it("is none when none is named, so a person is asked to choose", () => {
    expect(readOperation(undefined, undefined)).toBeUndefined();
  });

  it("is the operation an id names", () => {
    expect(readOperation("getProject", undefined)).toMatchObject({
      operation: {
        id: "getProject",
      },
    });
  });

  it("is one only a person's token or a session calls, which your sign-in can", () => {
    expect(readOperation("getMyUser", undefined)).toMatchObject({
      operation: { id: "getMyUser" },
    });
  });

  it("refuses one the CLI cannot call, saying why", () => {
    expect(() => {
      readOperation("getMySession", undefined);
    }).toThrow(
      expect.objectContaining({
        code: "E_VALIDATION",
        message: expect.stringContaining("session cookie"),
      }),
    );
  });
});

describe("--paginate", () => {
  it("is allowed when it is not given", () => {
    expect(() => {
      refuseUnpaged(resolveTarget("getProject"), false);
    }).not.toThrow();
  });

  it("is allowed while the operation is still to be chosen", () => {
    expect(() => {
      refuseUnpaged(undefined, true);
    }).not.toThrow();
  });

  it("is allowed for an operation that has a cursor to follow", () => {
    expect(() => {
      refuseUnpaged(resolveTarget("queryUsers"), true);
    }).not.toThrow();
  });

  it("is refused for an operation that does not page, naming it", () => {
    expect(() => {
      refuseUnpaged(resolveTarget("getProject"), true);
    }).toThrow(
      expect.objectContaining({
        code: "E_VALIDATION",
        message: "getProject does not page, so --paginate has nothing to follow",
      }),
    );
  });
});

function request(input: { destructive: boolean; body: unknown }) {
  return {
    operation: {
      id: "deleteUser",
      destructive: input.destructive,
    },
    body: input.body,
  } as never;
}

function forcing(run: { dryRun?: boolean; nonInteractive?: boolean; force?: boolean }) {
  return {
    dryRun: run.dryRun ?? false,
    nonInteractive: run.nonInteractive ?? false,
    force: run.force ?? false,
  };
}

describe("--force on a call that cannot be asked about", () => {
  const withBody = request({ destructive: true, body: { name: "a" } });

  it("is required for a destructive call with a body nobody can be asked about", () => {
    expect(() => {
      refuseUnforced(withBody, forcing({ nonInteractive: true }));
    }).toThrow(
      expect.objectContaining({
        code: "E_VALIDATION",
        message: "Cannot call deleteUser without --force in non-interactive mode",
      }),
    );
  });

  it("is satisfied once it is given", () => {
    expect(() => {
      refuseUnforced(withBody, forcing({ nonInteractive: true, force: true }));
    }).not.toThrow();
  });

  it("is not required on a terminal, where the person is asked instead", () => {
    expect(() => {
      refuseUnforced(withBody, forcing({}));
    }).not.toThrow();
  });

  it("is not required by a dry run, which calls nothing", () => {
    expect(() => {
      refuseUnforced(withBody, forcing({ nonInteractive: true, dryRun: true }));
    }).not.toThrow();
  });

  it("is not required by a call that is not destructive", () => {
    expect(() => {
      refuseUnforced(
        request({ destructive: false, body: { name: "a" } }),
        forcing({ nonInteractive: true }),
      );
    }).not.toThrow();
  });

  it("is not required by a destructive call with no body to lose", () => {
    expect(() => {
      refuseUnforced(
        request({ destructive: true, body: undefined }),
        forcing({ nonInteractive: true }),
      );
    }).not.toThrow();
  });
});

describe("-X", () => {
  it.each(["GET", "POST", "PUT", "PATCH", "DELETE"])("sends %s", async (method) => {
    await expect(parseFlag(Api.flags.method, method, "method")).resolves.toBe(method);
  });

  it("takes any case, as curl does", async () => {
    await expect(parseFlag(Api.flags.method, "delete", "method")).resolves.toBe("DELETE");
  });

  it.each(["trace", "OPTIONS", ""])(
    "refuses %j, naming it and the methods that exist",
    async (value) => {
      await expect(parseFlag(Api.flags.method, value, "method")).rejects.toMatchObject({
        code: "E_VALIDATION",
        message: `-X ${value} is not one of GET, POST, PUT, PATCH, DELETE`,
      });
    },
  );
});

const SERVER = "http://localhost:8080";
const SECRET = { project_id: "proj_1", project_secret: "sk_proj" } as ZitadelSecret;
const SIGN_IN = { token: "login_token", who: "dev@acme.com" };

/** The credential `zitadel api` calls `id` with, holding `held`. */
function calling(id: string, held: Held) {
  return credentialFor(resolveTarget(id).operation, held, SERVER, (next): SuggestedCommand => {
    return unscopedCommand(next);
  });
}

describe("the credential zitadel api calls with", () => {
  it("is your sign-in for an operation a person's token may call", () => {
    expect(calling("queryUsers", { secret: SECRET, signIn: SIGN_IN })).toEqual({
      used: "login",
      token: "login_token",
    });
  });

  it("is the project secret while nobody is signed in", () => {
    expect(calling("queryUsers", { secret: SECRET })).toEqual({
      used: "project",
      token: "sk_proj",
    });
  });

  it("is the project secret for one no person's token may call", () => {
    expect(calling("createAuthAttempt", { secret: SECRET, signIn: SIGN_IN })).toEqual({
      used: "project",
      token: "sk_proj",
    });
  });

  it("is your sign-in for one only a person's token or a session calls", () => {
    expect(calling("getMyUser", { signIn: SIGN_IN })).toEqual({
      used: "login",
      token: "login_token",
    });
  });

  it("is nothing for one that needs no credential", () => {
    expect(calling("getLive", { secret: SECRET, signIn: SIGN_IN })).toBeUndefined();
  });

  it("refuses one only a person's token calls while nobody is signed in, suggesting zitadel login", () => {
    expect(() => calling("getMyUser", { secret: SECRET })).toThrow(
      expect.objectContaining({
        code: "E_CREDENTIAL_MISSING",
        nextCommands: [`zitadel login --server ${SERVER}`],
      }),
    );
  });

  describe("--credential project", () => {
    it("takes the secret over your sign-in", () => {
      expect(calling("queryUsers", { secret: SECRET, signIn: SIGN_IN, forced: "project" })).toEqual(
        { used: "project", token: "sk_proj" },
      );
    });

    it("refuses one only a person's token calls", () => {
      expect(() => calling("getMyUser", { signIn: SIGN_IN, forced: "project" })).toThrow(
        expect.objectContaining({
          code: "E_VALIDATION",
          message: expect.stringContaining("--credential project cannot call it"),
        }),
      );
    });
  });

  describe("--credential login", () => {
    it("takes your sign-in", () => {
      expect(calling("queryUsers", { secret: SECRET, signIn: SIGN_IN, forced: "login" })).toEqual({
        used: "login",
        token: "login_token",
      });
    });

    it("refuses one no person's token may call", () => {
      expect(() => calling("createAuthAttempt", { secret: SECRET, forced: "login" })).toThrow(
        expect.objectContaining({
          code: "E_VALIDATION",
          message: expect.stringContaining("--credential login cannot call it"),
        }),
      );
    });

    it("refuses while nobody is signed in", () => {
      expect(() => calling("queryUsers", { secret: SECRET, forced: "login" })).toThrow(
        expect.objectContaining({ code: "E_CREDENTIAL_MISSING" }),
      );
    });
  });
});

describe("what zitadel api offers to choose from", () => {
  it("is an operation a person's token may call once you signed in, without a project", () => {
    expect(holdsFor(resolveTarget("queryUsers").operation, { signIn: SIGN_IN })).toBe(true);
  });

  it("leaves out one only the project secret calls while there is no project", () => {
    expect(holdsFor(resolveTarget("createAuthAttempt").operation, { signIn: SIGN_IN })).toBe(false);
  });
});

describe("the project zitadel api calls on behalf of", () => {
  it("is not required for an operation called as you", async ({ dir }) => {
    await expect(
      readProjectSecret(resolveTarget("queryUsers"), dir, { signIn: SIGN_IN }),
    ).resolves.toBeUndefined();
  });

  it("is required for an operation the project secret calls while nobody is signed in", async ({
    dir,
  }) => {
    await expect(readProjectSecret(resolveTarget("queryUsers"), dir)).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
  });
});
