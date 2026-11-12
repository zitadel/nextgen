import { describe, expect, it } from "vitest";

import { ZitadelError } from "@/lib/errors";
import {
  asideText,
  envelopeText,
  Failure,
  JsonFailureOutput,
  TerminalFailureOutput,
} from "@/lib/oclif/failure";
import type { ErrorEnvelope } from "@/lib/oclif/types";
import type { Summary } from "@/lib/ui";
import { unscopedCommand } from "@/lib/suggestion";

const META = { cliVersion: "1.2.3", command: "teams:delete", source: "" };

const refusal = new ZitadelError("E_VALIDATION", "teams delete is not a zitadel command.", {
  hint: "Run `zitadel teams --help`.",
  nextCommands: [unscopedCommand("teams --help")],
});

describe("JsonFailureOutput", () => {
  it("writes the error envelope, its hint spelled out as the public command", () => {
    const written: ErrorEnvelope[] = [];

    new JsonFailureOutput((envelope) => {
      written.push(envelope);
    }).write(new Failure(refusal, META));

    expect(written).toEqual([
      {
        status: "error",
        cli_version: "1.2.3",
        command: "teams:delete",
        source: "",
        code: "E_VALIDATION",
        message: "teams delete is not a zitadel command.",
        hint: "Run npx @zitadel/cli@1.2.3 teams --help.",
        next_commands: ["npx @zitadel/cli@1.2.3 teams --help"],
        details: undefined,
      },
    ]);
  });

  it("keeps the message as it came, which a reader parses", () => {
    const written: ErrorEnvelope[] = [];

    new JsonFailureOutput((envelope) => {
      written.push(envelope);
    }).write(new Failure(new ZitadelError("E_VALIDATION", "Refused \u001b[2Jwiped"), META));

    expect(written).toEqual([expect.objectContaining({ message: "Refused \u001b[2Jwiped" })]);
  });

  it("carries the warnings the run reported, and none when it reported none", () => {
    const written: ErrorEnvelope[] = [];
    const output = new JsonFailureOutput((envelope) => {
      written.push(envelope);
    });

    output.write(new Failure(refusal, META, ["slow"]));
    output.write(new Failure(refusal, META));

    expect(
      written.map((envelope) => {
        return envelope.warnings;
      }),
    ).toEqual([["slow"], undefined]);
  });
});

describe("TerminalFailureOutput", () => {
  it("draws the coded sentence, the hint and the commands to run next", () => {
    const drawn: Summary[] = [];

    new TerminalFailureOutput(
      (summary) => {
        drawn.push(summary);
        return "";
      },
      () => {},
      { tty: true, forced: false },
    ).write(new Failure(refusal, META));

    expect(drawn).toEqual([
      {
        title: "Error: teams delete is not a zitadel command. (E_VALIDATION)",
        sections: [],
        lines: ["Run npx @zitadel/cli@1.2.3 teams --help."],
        next: [{ text: "Next:", command: "npx @zitadel/cli@1.2.3 teams --help" }],
        boxed: true,
        failed: true,
      },
    ]);
  });
});

describe("TerminalFailureOutput's stderr", () => {
  it.each([
    [{ tty: true, forced: false }, "\u001b[31mred\u001b[39m"],
    [{ tty: false, forced: true }, "\u001b[31mred\u001b[39m"],
    [{ tty: false, forced: false }, "red"],
  ])("written to stderr %j is %j", (stderr, expected) => {
    const written: string[] = [];

    new TerminalFailureOutput(
      () => {
        return "\u001b[31mred\u001b[39m";
      },
      (text) => {
        written.push(text);
      },
      stderr,
    ).write(new Failure(refusal, META));

    expect(written).toEqual([expected]);
  });
});

describe("envelopeText", () => {
  // JSON.stringify leaves a format character such as the bidi override as it
  // is, so it is the one the spelling exists for.
  it("spells out a format character a value carries, so the text still parses", () => {
    const text = envelopeText({ message: "a\u202eb" }, undefined);

    expect({ raw: text.includes("\u202e"), parsed: JSON.parse(text) }).toEqual({
      raw: false,
      parsed: { message: "a\u202eb" },
    });
  });
});

describe("asideText", () => {
  it.each([
    [{ tty: true, forced: false }, "\u001b[31mred\u001b[39m"],
    [{ tty: false, forced: true }, "\u001b[31mred\u001b[39m"],
    [{ tty: false, forced: false }, "red"],
  ])("with stderr %j keeps %j", (stderr, expected) => {
    expect(asideText("\u001b[31mred\u001b[39m", stderr)).toBe(expected);
  });
});
