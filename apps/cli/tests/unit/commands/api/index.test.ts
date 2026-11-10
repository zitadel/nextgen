import { describe, expect, it } from "vitest";

import Api, { readOperation, refuseUnforced, refuseUnpaged } from "@/commands/api/index";
import { parseFlag } from "@tests/helpers/inputs";
import { Operation } from "@/lib/backend";

const resolveTarget = (ref: string, method?: string) => Operation.named(ref, method);

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

  it("refuses one the CLI cannot call, saying why", () => {
    expect(() => {
      readOperation("getMyUser", undefined);
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
        code: "E_CONFIRMATION_REQUIRED",
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
