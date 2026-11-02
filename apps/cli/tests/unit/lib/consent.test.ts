import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", () => ({
  confirm: vi.fn(),
  cancel: vi.fn(),
  isCancel: vi.fn().mockReturnValue(false),
}));

import { confirm, isCancel } from "@clack/prompts";

import { createZitadelClient, type ZitadelClient } from "../../../src/lib/api-client";
import { Consent, type Gate, isRefusal } from "../../../src/lib/consent";
import { ZitadelError } from "../../../src/lib/errors";
import { unscopedCommand } from "../../../src/lib/suggestion";

const GATE: Gate = {
  verb: "remove",
  name: "remove API_URL from the project",
  message: "Remove API_URL from the project?",
  retry: unscopedCommand("variable rm API_URL --force"),
};
/** A client as every command gets one; nothing here sends a request. */
const aClient = () => createZitadelClient({ baseUrl: "http://localhost:8080" });
const asked = { interactive: true, force: false, dryRun: false };
const forced = { interactive: false, force: true, dryRun: false };
const scripted = { interactive: false, force: false, dryRun: false };

/** What a refused request threw. */
const refusalOf = (session: typeof scripted, gate: Gate = GATE) =>
  Consent.request(gate, session).then(
    () => expect.unreachable("consent was given"),
    (error: unknown) => error,
  );

afterEach(() => {
  vi.mocked(confirm).mockReset();
  vi.mocked(isCancel).mockReturnValue(false);
});

describe("Consent", () => {
  describe("request", () => {
    it("is given by --force without asking", async () => {
      await Consent.request(GATE, forced);

      expect(confirm).not.toHaveBeenCalled();
    });

    it("is given by --force as a Consent", async () => {
      expect(await Consent.request(GATE, forced)).toBeInstanceOf(Consent);
    });

    it("is given by a yes", async () => {
      vi.mocked(confirm).mockResolvedValueOnce(true as never);

      expect(await Consent.request(GATE, asked)).toBeInstanceOf(Consent);
    });

    it("is withheld by a no", async () => {
      vi.mocked(confirm).mockResolvedValueOnce(false as never);

      expect(await Consent.request(GATE, asked)).toBeUndefined();
    });

    it("asks the gate's question", async () => {
      vi.mocked(confirm).mockResolvedValueOnce(false as never);

      await Consent.request(GATE, asked);

      expect(vi.mocked(confirm).mock.calls[0]?.[0]).toMatchObject({
        message: "Remove API_URL from the project?",
        initialValue: false,
      });
    });

    it("refuses without --force when nobody can be asked", async () => {
      expect(await refusalOf(scripted)).toMatchObject({
        code: "E_VALIDATION",
        message: "Cannot remove API_URL from the project without --force in non-interactive mode",
        nextCommands: ["zitadel variable rm API_URL --force"],
      });
    });

    it("refuses with the gate's own refusal when it has one", async () => {
      const refuse = (): never => {
        throw new ZitadelError("E_VALIDATION", "Enable another method first");
      };

      expect(await refusalOf(scripted, { ...GATE, refuse })).toMatchObject({
        message: "Enable another method first",
      });
    });

    it("never asks during a dry run", async () => {
      await expect(Consent.request(GATE, { ...forced, dryRun: true })).rejects.toThrow(
        "A dry run asked for consent to remove API_URL from the project",
      );
    });

    it("fails with E_CANCELLED on Ctrl-C", async () => {
      vi.mocked(confirm).mockResolvedValueOnce(Symbol("cancel") as never);
      vi.mocked(isCancel).mockReturnValueOnce(true);

      await expect(Consent.request(GATE, asked)).rejects.toMatchObject({ code: "E_CANCELLED" });
    });
  });

  describe("isRefusal", () => {
    it("knows a refusal for want of --force", async () => {
      expect(isRefusal(await refusalOf(scripted))).toBe(true);
    });

    it("knows a gate's own refusal", async () => {
      const refuse = (): never => {
        throw new ZitadelError("E_VALIDATION", "Enable another method first");
      };

      expect(isRefusal(await refusalOf(scripted, { ...GATE, refuse }))).toBe(true);
    });

    it("does not take any other validation error for one", () => {
      expect(isRefusal(new ZitadelError("E_VALIDATION", "No client id supplied"))).toBe(false);
    });

    it("does not take Ctrl-C for one", async () => {
      vi.mocked(confirm).mockResolvedValueOnce(Symbol("cancel") as never);
      vi.mocked(isCancel).mockReturnValueOnce(true);

      expect(isRefusal(await refusalOf(asked))).toBe(false);
    });
  });

  describe("assert", () => {
    it("accepts a consent request made", async () => {
      const consent = await Consent.request(GATE, forced);

      expect(() => Consent.assert(consent)).not.toThrow();
    });

    it.each([
      ["nothing", undefined],
      ["an object of the same shape", { verb: "remove", unlock: () => undefined }],
      ["an object built from its prototype", Object.create(Consent.prototype)],
      ["one constructed around its private constructor", Reflect.construct(Consent, [])],
    ])("refuses %s", (_label, value) => {
      expect(() => Consent.assert(value)).toThrow("A destructive operation ran without consent");
    });
  });

  describe("unlock", () => {
    it("hands back the client's destructive operations", async () => {
      const consent = await Consent.request(GATE, forced);

      expect(typeof consent?.unlock(aClient()).deleteVariable).toBe("function");
    });

    it("refuses a client createZitadelClient did not make", async () => {
      const consent = await Consent.request(GATE, forced);

      expect(() => consent?.unlock({} as ZitadelClient)).toThrow(
        "Only a client createZitadelClient made can be unlocked",
      );
    });

    it("refuses when called on something that is not a consent", () => {
      const forged = Object.create(Consent.prototype) as Consent;

      expect(() => forged.unlock(aClient())).toThrow("A destructive operation ran without consent");
    });
  });
});

describe("withholdDestructive", () => {
  it("refuses a destructive operation on the client, cast or not", () => {
    expect(() => (aClient() as unknown as Record<string, unknown>).deleteVariable).toThrow(
      "deleteVariable is destructive: reach it through a Consent",
    );
  });

  it("refuses a destructive operation reached around the type", () => {
    expect(() => Reflect.get(aClient(), "revokeRelease")).toThrow(
      "revokeRelease is destructive: reach it through a Consent",
    );
  });

  it("refuses a destructive operation reached through its property descriptor", () => {
    expect(() => Object.getOwnPropertyDescriptor(aClient(), "deleteVariable")).toThrow(
      "deleteVariable is destructive: reach it through a Consent",
    );
  });

  it("leaves every other operation reachable", () => {
    expect(typeof aClient().getVariable).toBe("function");
  });

  it("leaves updates reachable, which are not guarded", () => {
    expect(typeof aClient().updateVariables).toBe("function");
  });
});
