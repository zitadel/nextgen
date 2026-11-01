import type { Config } from "@oclif/core";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", () => ({
  confirm: vi.fn(),
  cancel: vi.fn(),
  isCancel: vi.fn().mockReturnValue(false),
}));

import { confirm } from "@clack/prompts";

import { Consent } from "../../../../src/lib/consent";
import { BaseCommand } from "../../../../src/lib/oclif/base";
import {
  Destructive,
  type DestructiveChange,
  Settled,
} from "../../../../src/lib/oclif/destructive";
import type { CommandResult } from "../../../../src/lib/oclif/types";

const GATE: Omit<DestructiveChange, "apply"> = {
  verb: "remove",
  name: "remove API_URL from the project",
  message: "Remove API_URL from the project?",
  preview: () => ({ status: "ok", data: { dry_run: true } }),
};

/** How a run was invoked: its arguments, and who can answer. */
type Invocation = {
  argv?: string[];
  force?: boolean;
  dryRun?: boolean;
  interactive?: boolean;
  /** The leading arguments the gate names for its retry. */
  arguments?: string[];
};

/** A destructive command that records what its act was handed. */
class Removing extends Destructive(BaseCommand) {
  public static override readonly id: string = "variable:rm";
  public readonly acted: unknown[] = [];
  public readonly ready: unknown[] = [];

  private readonly invocation: Invocation;

  constructor(invocation: Invocation) {
    super(invocation.argv ?? ["API_URL"], { version: "1.2.3" } as unknown as Config);
    this.invocation = invocation;
  }

  async run(): Promise<never> {
    throw new Error("unused");
  }

  public async remove(
    prepare?: DestructiveChange<string | undefined>["prepare"],
  ): Promise<CommandResult> {
    await this.toMeta(
      {
        "no-telemetry": true,
        force: this.invocation.force ?? false,
        "dry-run": this.invocation.dryRun ?? false,
      },
      { resolveServer: false, source: "mock" },
    );
    this.meta = { ...this.meta, nonInteractive: !(this.invocation.interactive ?? false) };
    return this.confirmed<string | undefined>({
      ...GATE,
      ...(this.invocation.arguments === undefined ? {} : { arguments: this.invocation.arguments }),
      prepare,
      apply: async (consent, ready) => {
        this.acted.push(consent);
        this.ready.push(ready);
        return { status: "ok", data: { acted: true } };
      },
    });
  }
}

/** A command whose oclif id is missing, as a class run without a manifest has. */
class Unnamed extends Removing {
  public static override readonly id = "";
}

afterEach(() => {
  vi.mocked(confirm).mockReset();
});

describe("Destructive", () => {
  describe("confirmed", () => {
    it("answers a dry run with the preview", async () => {
      const command = new Removing({ dryRun: true });

      expect(await command.remove()).toEqual({ status: "ok", data: { dry_run: true } });
    });

    it("never acts on a dry run, even with --force", async () => {
      const command = new Removing({ dryRun: true, force: true });

      await command.remove();

      expect(command.acted).toEqual([]);
    });

    it("never asks on a dry run", async () => {
      await new Removing({ dryRun: true, interactive: true }).remove();

      expect(confirm).not.toHaveBeenCalled();
    });

    it("acts with consent when --force is given", async () => {
      const command = new Removing({ force: true });

      await command.remove();

      expect(command.acted).toEqual([expect.any(Consent)]);
    });

    it("answers with what the act returned", async () => {
      expect(await new Removing({ force: true }).remove()).toEqual({
        status: "ok",
        data: { acted: true },
      });
    });

    it("acts with consent when the person says yes", async () => {
      vi.mocked(confirm).mockResolvedValueOnce(true as never);
      const command = new Removing({ interactive: true });

      await command.remove();

      expect(command.acted).toEqual([expect.any(Consent)]);
    });

    it("is skipped as <verb>-cancelled when the person says no", async () => {
      vi.mocked(confirm).mockResolvedValueOnce(false as never);

      expect(await new Removing({ interactive: true }).remove()).toEqual({
        status: "skipped",
        reason: "remove-cancelled",
      });
    });

    it("does not act when the person says no", async () => {
      vi.mocked(confirm).mockResolvedValueOnce(false as never);
      const command = new Removing({ interactive: true });

      await command.remove();

      expect(command.acted).toEqual([]);
    });

    it("refuses without --force when nobody can be asked", async () => {
      await expect(new Removing({}).remove()).rejects.toMatchObject({
        code: "E_VALIDATION",
        message: "Cannot remove API_URL from the project without --force in non-interactive mode",
      });
    });

    it("does not act when it refuses", async () => {
      const command = new Removing({});

      await command.remove().catch(() => undefined);

      expect(command.acted).toEqual([]);
    });

    it("suggests the same invocation again, with --force after its arguments", async () => {
      const command = new Removing({ argv: ["API_URL", "--preview", "--env", "staging"] });

      await expect(command.remove()).rejects.toMatchObject({
        nextCommands: [
          "npx @zitadel/cli@1.2.3 variable rm API_URL --force --preview --env staging",
        ],
      });
    });

    it("leaves the flags that only say how to answer out of the suggestion", async () => {
      const command = new Removing({ argv: ["API_URL", "--json", "-n"] });

      await expect(command.remove()).rejects.toMatchObject({
        nextCommands: ["npx @zitadel/cli@1.2.3 variable rm API_URL --force"],
      });
    });

    it("quotes an argument the shell would expand in the suggestion", async () => {
      const command = new Removing({ argv: ["https://*.example.com"] });

      await expect(command.remove()).rejects.toMatchObject({
        nextCommands: ["npx @zitadel/cli@1.2.3 variable rm 'https://*.example.com' --force"],
      });
    });
    it("never prepares on a dry run", async () => {
      const prepare = vi.fn(async () => "read");

      await new Removing({ dryRun: true, force: true }).remove(prepare);

      expect(prepare).not.toHaveBeenCalled();
    });

    it("hands the act what prepare read", async () => {
      const command = new Removing({ force: true });

      await command.remove(async () => "read");

      expect(command.ready).toEqual(["read"]);
    });

    it("prepares before it asks", async () => {
      vi.mocked(confirm).mockResolvedValueOnce(false as never);
      const prepare = vi.fn(async () => "read");

      await new Removing({ interactive: true }).remove(prepare);

      expect(prepare.mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(confirm).mock.invocationCallOrder[0] ?? 0,
      );
    });

    it("ends the run with a settled result, without asking", async () => {
      const settled = { status: "skipped", reason: "not-live" } as const;

      expect(
        await new Removing({ interactive: true }).remove(async () => new Settled(settled)),
      ).toEqual(settled);
    });

    it("does not ask when prepare settles the run", async () => {
      await new Removing({ interactive: true }).remove(
        async () => new Settled({ status: "skipped", reason: "not-live" }),
      );

      expect(confirm).not.toHaveBeenCalled();
    });

    it("leaves a URL's credentials out of the suggestion", async () => {
      const command = new Removing({ argv: ["API_URL", "--server", "https://me:secret@host"] });

      await expect(command.remove()).rejects.toMatchObject({
        nextCommands: ["npx @zitadel/cli@1.2.3 variable rm API_URL --force --server https://host"],
      });
    });

    it("leaves a password holding an @ out of the suggestion", async () => {
      const command = new Removing({
        argv: ["API_URL", "--server", "https://me:part1@part2@host/path"],
      });

      await expect(command.remove()).rejects.toMatchObject({
        nextCommands: [
          "npx @zitadel/cli@1.2.3 variable rm API_URL --force --server https://host/path",
        ],
      });
    });

    it("names the gate's arguments in place of the typed ones", async () => {
      const command = new Removing({ argv: ["--env", "staging"], arguments: ["API_URL"] });

      await expect(command.remove()).rejects.toMatchObject({
        nextCommands: ["npx @zitadel/cli@1.2.3 variable rm API_URL --force --env staging"],
      });
    });

    it("keeps the arguments after -- last, after --force", async () => {
      const command = new Removing({ argv: ["--env", "staging", "--", "-FOO"] });

      await expect(command.remove()).rejects.toMatchObject({
        nextCommands: ["npx @zitadel/cli@1.2.3 variable rm --force --env staging -- -FOO"],
      });
    });

    it("leaves a URL's credentials out of the arguments after --", async () => {
      const command = new Removing({ argv: ["--", "https://me:secret@host"] });

      await expect(command.remove()).rejects.toMatchObject({
        nextCommands: ["npx @zitadel/cli@1.2.3 variable rm --force -- https://host"],
      });
    });

    it("suggests no empty command word when the command has no id", async () => {
      await expect(new Unnamed({}).remove()).rejects.toMatchObject({
        nextCommands: ["npx @zitadel/cli@1.2.3 API_URL --force"],
      });
    });
  });
});
