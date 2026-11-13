import type { GetVariable200 } from "@zitadel/api/generated/model";
import { HttpResponse, http } from "msw";
import { describe, expect, vi } from "vitest";

import { it } from "@tests/helpers/fixtures";

import { ForbiddenError, NotFoundError, UnauthorizedError } from "@/lib/backend/errors";
import {
  Variable,
  VariableRemoval,
  VariableService,
  VariableWrite,
} from "@/lib/backend/services/variable";
import { createZitadelClient } from "@/lib/backend";
import { ZitadelError } from "@/lib/errors";
import { type ClientStubs, fakeClient } from "@tests/helpers/fake-client";

/** A server a cancelled run is pointed at. */
const CANCEL_SERVER = "http://localhost:8080";

/** A value the API answers for a secret: named, never disclosed. */
const SECRET: GetVariable200["primary"] = { secret: true };

/** A service answering `stubs`, bound to one project. */
function service(stubs: ClientStubs): VariableService {
  return new VariableService(fakeClient(stubs), "proj_1");
}

describe("VariableService.nameProblem", () => {
  it.each(["GOOGLE_CLIENT_ID", "retry2", "a", "_x1", "A".repeat(255)])("accepts %j", (name) => {
    expect(VariableService.nameProblem(name)).toBeUndefined();
  });

  it.each(["GOOGLE-CLIENT", "a.b", "a b", ""])("calls %j invalid", (name) => {
    expect(VariableService.nameProblem(name)).toBe("invalid");
  });

  it("calls a name past the schema's limit too long", () => {
    expect(VariableService.nameProblem("A".repeat(256))).toBe("too-long");
  });
});

describe("VariableWrite.kinds", () => {
  it("writes both kinds for a plain value and the primary kind for a secret", () => {
    expect(VariableWrite.of({ secret: false, preview: false }).kinds).toEqual([
      "primary",
      "preview",
    ]);
    expect(VariableWrite.of({ secret: true, preview: false }).kinds).toEqual(["primary"]);
  });

  it("writes the preview kind alone for a preview write", () => {
    expect(VariableWrite.of({ secret: false, preview: true }).kinds).toEqual(["preview"]);
    expect(VariableWrite.of({ secret: true, preview: true }).kinds).toEqual(["preview"]);
  });
});

describe("VariableRemoval.kinds", () => {
  it("clears both kinds, or the preview kind alone", () => {
    expect(VariableRemoval.of({ preview: false }).kinds).toEqual(["primary", "preview"]);
    expect(VariableRemoval.of({ preview: true }).kinds).toEqual(["preview"]);
  });
});

describe("Variable.fromValues", () => {
  it("marks secrets as held and carries no value for them", () => {
    const variables = Variable.fromValues({
      GOOGLE_CLIENT_SECRET: SECRET,
      GOOGLE_CLIENT_ID: "999-prod",
    });

    expect(JSON.parse(JSON.stringify(variables))).toEqual([
      { name: "GOOGLE_CLIENT_ID", secret: false, value: "999-prod" },
      { name: "GOOGLE_CLIENT_SECRET", secret: true },
    ]);
    expect(variables[1]).not.toHaveProperty("value");
  });

  it("keeps a scalar's JSON type", () => {
    expect(
      JSON.parse(JSON.stringify(Variable.fromValues({ RETRY_COUNT: 5, DEBUG: true }))),
    ).toEqual([
      { name: "DEBUG", secret: false, value: true },
      { name: "RETRY_COUNT", secret: false, value: 5 },
    ]);
  });

  it("sorts by name so output is stable between runs", () => {
    const variables = Variable.fromValues({ B: "2", A: "1", C: "3" });

    expect(variables.map((variable) => variable.name)).toEqual(["A", "B", "C"]);
  });

  it("reports an owner that holds nothing", () => {
    expect(Variable.fromValues({})).toEqual([]);
  });
});

describe("Variable.inventory", () => {
  it("lists a name that holds only a preview value", () => {
    const [variable] = Variable.inventory({ API_URL: { preview: "https://preview.acme.com" } });

    expect(variable?.name).toBe("API_URL");
    expect(variable?.value).toBeUndefined();
    expect(variable?.preview).toEqual({ secret: false, value: "https://preview.acme.com" });
  });

  it("marks a name whose primary value is a secret", () => {
    const [variable] = Variable.inventory({ TOKEN: { primary: SECRET } });

    expect(variable?.secret).toBe(true);
    expect(variable?.preview).toBeUndefined();
  });
});

describe("VariableService.inventory", () => {
  it("reads every kind at once, so a preview-only name is listed too", async () => {
    const listVariables = vi.fn(async () => ({
      API_URL: { primary: "https://acme.com", preview: "https://preview.acme.com" },
      PREVIEW_ONLY: { preview: "x" },
    }));

    const variables = await service({ listVariables }).inventory();

    expect(listVariables).toHaveBeenCalledWith({ project_id: "proj_1" });
    expect(variables.map((variable) => variable.name)).toEqual(["API_URL", "PREVIEW_ONLY"]);
  });
});

describe("VariableService.previews", () => {
  it("reads the preview kind alone, and never merges the primary values in", async () => {
    const listVariables = vi.fn(async () => ({ API_URL: { preview: "https://preview.acme.com" } }));

    const variables = await service({ listVariables }).previews();

    expect(listVariables).toHaveBeenCalledWith({ project_id: "proj_1", kind: "preview" });
    expect(variables.map((variable) => variable.value)).toEqual(["https://preview.acme.com"]);
  });
});

describe("VariableService.get", () => {
  it("answers the value the name holds in the kind asked for", async () => {
    const getVariable = vi.fn(async () => ({ primary: "999-prod" }));

    const variable = await service({ getVariable }).get("CLIENT_ID", "primary");

    expect(getVariable).toHaveBeenCalledWith("CLIENT_ID", {
      project_id: "proj_1",
      kind: "primary",
    });
    expect(variable.value).toBe("999-prod");
  });

  it("refuses a name that holds no value of that kind, saying how one is set", async () => {
    await expect(
      service({ getVariable: async () => ({}) }).get("CLIENT_ID", "preview"),
    ).rejects.toMatchObject({
      name: "NotFoundError",
      message: "Variable CLIENT_ID has no preview value.",
      hint: "A name has a preview value only once one is set with `--preview`.",
    });
  });
});

describe("VariableService.heldByName", () => {
  it("says of each name whether it is a secret", async () => {
    const held = await service({
      listVariables: async () => ({
        TOKEN: { primary: SECRET },
        API_URL: { primary: "https://acme.com" },
      }),
    }).heldByName("primary");

    expect([...held]).toEqual([
      ["TOKEN", true],
      ["API_URL", false],
    ]);
  });

  it("raises a token's refusal to read the values of that kind", async () => {
    await expect(
      service({
        listVariables: async () => {
          throw new ForbiddenError("Forbidden", { status: 403 });
        },
      }).heldByName("primary"),
    ).rejects.toMatchObject({ name: "ForbiddenError" });
  });
});

/** A promise settled by hand, so a test can hold two reads open at once. */
function promise(): { settled: Promise<void>; settle: () => void } {
  const held: { settle: () => void } = {
    settle: () => {
      return undefined;
    },
  };
  const settled = new Promise<void>((resolve) => {
    held.settle = resolve;
  });
  return {
    settled,
    settle: () => {
      held.settle();
    },
  };
}

describe("VariableService.set", () => {
  /** A write of a plain preview value, whose primary read answers `primary`. */
  function setPreviewOver(primary: () => Promise<GetVariable200>) {
    return service({
      getVariable: primary,
      listVariables: async () => ({}),
      setVariables: async () => ({ API_KEY: { preview: "x" } }),
    }).set("API_KEY", "x", VariableWrite.of({ secret: false, preview: true }));
  }

  it("reads back the kinds the write did not answer together, not one after the other", async () => {
    const answer = [promise(), promise()];
    const inFlight = { now: 0, most: 0 };
    const listVariables = vi.fn(async () => {
      inFlight.now += 1;
      inFlight.most = Math.max(inFlight.most, inFlight.now);
      await answer[inFlight.now - 1]?.settled;
      inFlight.now -= 1;
      return {};
    });

    const written = service({
      listVariables,
      setVariables: async () => ({}),
    }).set("API_KEY", "x", VariableWrite.of({ secret: false, preview: false }));
    for (const one of answer) {
      one.settle();
    }
    await written;

    expect(listVariables).toHaveBeenCalledTimes(2);
    // Asked in turn, the second read would not have started until the first
    // had answered, so only one would ever have been in flight.
    expect(inFlight.most).toBe(2);
  });

  it("writes the value and the secret flag the write carries", async () => {
    const setVariables = vi.fn(async () => ({ API_KEY: { primary: SECRET } }));

    await service({ setVariables, listVariables: async () => ({}) }).set(
      "API_KEY",
      "s3cret",
      VariableWrite.of({ secret: true, preview: false }),
    );

    expect(setVariables).toHaveBeenCalledWith(
      { API_KEY: { value: "s3cret", secret: true } },
      { project_id: "proj_1" },
    );
  });

  it("scopes a preview write to the preview kind alone", async () => {
    const setVariables = vi.fn(async () => ({ API_KEY: { preview: "x" } }));

    await service({
      setVariables,
      getVariable: async () => ({ primary: "x" }),
      listVariables: async () => ({}),
    }).set("API_KEY", "x", VariableWrite.of({ secret: false, preview: true }));

    expect(setVariables).toHaveBeenCalledWith(expect.anything(), {
      project_id: "proj_1",
      kind: "preview",
    });
  });

  it("answers what the name holds in each kind afterwards", async () => {
    const written = await service({
      setVariables: async () => ({ API_KEY: { primary: "new" } }),
      listVariables: async () => ({ API_KEY: { preview: "old-preview" } }),
    }).set("API_KEY", "new", VariableWrite.of({ secret: false, preview: false }));

    expect(written).toMatchObject({
      name: "API_KEY",
      outcome: "set",
      state: {
        primary: { value: "new" },
        preview: { value: "old-preview" },
      },
    });
  });

  it("reports a kind it could not read back as unverified, and the write as done", async () => {
    const refused = new ForbiddenError("the token may not read the preview values", {
      status: 403,
    });

    const written = await service({
      // The write names the primary kind, so only the preview kind is read back.
      setVariables: async () => ({ API_KEY: { primary: "new" } }),
      listVariables: async () => {
        throw refused;
      },
    }).set("API_KEY", "new", VariableWrite.of({ secret: true, preview: false }));

    // The write returned before the read was made, so it stands.
    expect(written).toMatchObject({
      name: "API_KEY",
      outcome: "set",
      state: {
        primary: { value: "new" },
      },
    });
    expect(written).toMatchObject({
      unverified: [{ kind: "preview", cause: refused }],
    });
  });

  it("holds nothing against a kind it read back as empty", async () => {
    const written = await service({
      setVariables: async () => ({ API_KEY: { primary: "new" } }),
      listVariables: async () => ({}),
    }).set("API_KEY", "new", VariableWrite.of({ secret: true, preview: false }));

    // Read and found empty is not the same as never read: nothing is unverified.
    expect(written).toMatchObject({
      outcome: "set",
      state: {
        preview: undefined,
      },
      unverified: [],
    });
  });

  it("writes a plain preview value for a name whose primary value is plain", async () => {
    await expect(setPreviewOver(async () => ({ primary: "x" }))).resolves.toMatchObject({
      name: "API_KEY",
      outcome: "set",
    });
  });

  it("refuses a plain preview value for a name whose primary value is a secret", async () => {
    await expect(setPreviewOver(async () => ({ primary: SECRET }))).resolves.toEqual({
      name: "API_KEY",
      outcome: "needs-secret-preview",
    });
  });

  it("writes a plain preview value for a name the project has not entered", async () => {
    await expect(
      setPreviewOver(async () => {
        throw new NotFoundError("no such variable", { status: 404 });
      }),
    ).resolves.toMatchObject({ outcome: "set" });
  });

  it("leaves the check to whoever can read the primary values on a 403", async () => {
    await expect(
      setPreviewOver(async () => {
        throw new ForbiddenError("Forbidden", { status: 403 });
      }),
    ).resolves.toMatchObject({ outcome: "set" });
  });

  it("fails on a credential the server does not accept, rather than reading it as no secret", async () => {
    await expect(
      setPreviewOver(async () => {
        throw new UnauthorizedError("Unauthorized", { status: 401 });
      }),
    ).rejects.toMatchObject({ name: "UnauthorizedError" });
  });

  it("fails on any other error, since writing on an unknown is the outcome it guards against", async () => {
    await expect(
      setPreviewOver(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});

describe("VariableService.remove", () => {
  it("clears both kinds for a plain removal", async () => {
    const deleteVariable = vi.fn(async () => undefined);

    await service({ deleteVariable }).remove("API_KEY", VariableRemoval.of({ preview: false }));

    expect(deleteVariable).toHaveBeenCalledWith("API_KEY", { project_id: "proj_1" });
  });

  it("clears the preview kind alone for a preview removal", async () => {
    const deleteVariable = vi.fn(async () => undefined);

    await service({ deleteVariable }).remove("API_KEY", VariableRemoval.of({ preview: true }));

    expect(deleteVariable).toHaveBeenCalledWith("API_KEY", {
      project_id: "proj_1",
      kind: "preview",
    });
  });
});

describe("VariableService.set when the run is cancelled", () => {
  it("throws the cancellation instead of answering the kind unverified", async ({ server }) => {
    // The write lands and the read back is cut off by Ctrl-C. Reporting the
    // kind as unread would have the command print a result and exit as though
    // it had finished, so the cancellation is the answer.
    const controller = new AbortController();
    const cancelled = new ZitadelError("E_CANCELLED", "Cancelled.");
    server.use(
      http.patch(`${CANCEL_SERVER}/api/v1/variables`, () => {
        return HttpResponse.json({
          HOST: { primary: "app.acme.com" },
        });
      }),
      http.get(`${CANCEL_SERVER}/api/v1/variables`, () => {
        controller.abort(cancelled);
        return HttpResponse.error();
      }),
    );
    const variableService = new VariableService(
      createZitadelClient({
        baseUrl: CANCEL_SERVER,
        signal: controller.signal,
      }),
      "proj_1",
    );

    await expect(
      variableService.set(
        "HOST",
        "app.acme.com",
        VariableWrite.of({
          secret: false,
          preview: false,
        }),
      ),
    ).rejects.toBeDefined();
  });
});
