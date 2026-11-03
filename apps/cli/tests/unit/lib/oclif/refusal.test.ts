import { describe, expect, it } from "vitest";

import { interpolate, refusalError } from "../../../../src/lib/oclif/refusal";
import { unscopedCommand } from "../../../../src/lib/suggestion";

describe("interpolate", () => {
  it("fills each placeholder from the values", () => {
    expect(interpolate("{flag} cannot be {value}", { flag: "--port", value: 0 })).toBe(
      "--port cannot be 0",
    );
  });

  it("fills a placeholder named with a hyphen", () => {
    expect(interpolate("{sso-client-id} is set", { "sso-client-id": "abc" })).toBe("abc is set");
  });

  it("fills a placeholder that appears twice", () => {
    expect(interpolate("{a}{a}", { a: "x" })).toBe("xx");
  });

  it("refuses a placeholder that has no value", () => {
    expect(() => interpolate("{missing}", {})).toThrow("The placeholder {missing}");
  });
});

describe("refusalError", () => {
  it("raises E_VALIDATION with the message and the hint filled in", () => {
    const error = refusalError(
      {
        message: "{value} is not a TCP port",
        hint: "Use a port from {min}.",
      },
      {
        value: "99999",
        min: 1,
      },
      (command) => unscopedCommand(command, "1.0.0"),
    );

    expect(error.code).toBe("E_VALIDATION");
    expect(error.message).toBe("99999 is not a TCP port");
    expect(error.hint).toBe("Use a port from 1.");
  });

  it("turns each next command into a suggestion through the builder it is given", () => {
    const error = refusalError(
      {
        message: "No server",
        next: ["start --port {port}"],
      },
      {
        port: 8080,
      },
      (command) => unscopedCommand(command, "1.0.0"),
    );

    expect(error.nextCommands).toEqual([unscopedCommand("start --port 8080", "1.0.0")]);
  });

  it("carries no hint and no suggestions when the refusal has none", () => {
    const error = refusalError({ message: "No" }, {}, (command) =>
      unscopedCommand(command, "1.0.0"),
    );

    expect(error.hint).toBeUndefined();
    expect(error.nextCommands).toBeUndefined();
  });
});

describe("refusalError with a code and details", () => {
  it("raises the code it names, carrying its details", () => {
    const error = refusalError(
      {
        code: "E_NOT_FOUND",
        message: "No {name}",
        details: {
          file: "schema.json",
        },
      },
      {
        name: "flow",
      },
      (command) => unscopedCommand(command, "1.0.0"),
    );

    expect(error.code).toBe("E_NOT_FOUND");
    expect(error.message).toBe("No flow");
    expect(error.details).toEqual({ file: "schema.json" });
  });
});

describe("refusalError without a way to suggest", () => {
  it("raises a refusal that names no next command", () => {
    expect(refusalError({ message: "No" }, {}).message).toBe("No");
  });

  it("refuses to raise one that names a next command", () => {
    expect(() => refusalError({ message: "No", next: ["start"] }, {})).toThrow(
      "names next commands",
    );
  });
});

describe("refusalError details", () => {
  it("keeps a list a list when a detail is only a placeholder", () => {
    const error = refusalError(
      {
        message: "No {noun}",
        details: {
          missing: "{names}",
          note: "see {noun}",
        },
      },
      {
        noun: "column",
        names: ["a", "b"],
      },
    );

    expect(error.details).toEqual({
      missing: ["a", "b"],
      note: "see column",
    });
  });
});
