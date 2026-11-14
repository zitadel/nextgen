import { describe, expect, it } from "vitest";

import { ClaimQuestions, claimTable, type MappingState } from "@/lib/idp";
import { asker } from "@/lib/input";
import { Ui } from "@/lib/ui";
import { answering } from "@tests/helpers/keyboard";
import { asTerminal } from "@tests/helpers/terminal";

/**
 * What a hostile value carries: an OSC sequence that would set the window title
 * and the bell that ends it.
 */
const HOSTILE = "\u001b]0;pwned\u0007";

/**
 * How {@link HOSTILE} is spelled once it is escaped.
 */
const SPELLED = "\\x1b]0;pwned\\x07";

/**
 * A mapping of three attributes: one verified by a claim, one trusted outright
 * and one not verified at all.
 */
const STATE: MappingState = {
  attributes: [],
  mapping: { email: "email", phoneNumber: "phone_number", givenName: "given_name" },
  claimTypes: {},
  verified: { email: "email_verified", phoneNumber: true },
  scopes: [],
  explicit: [],
  unverifiedByReplacing: [],
  created: [],
};

describe("claimTable", () => {
  it("heads the columns with the provider the claims come from", () => {
    expect(claimTable(STATE, "Acme SSO")[0]).toBe(
      'User attribute  Claim from "Acme SSO"  Verified',
    );
  });

  it("says who vouches for each attribute, aligned under the header", () => {
    expect(claimTable(STATE, "Acme SSO").slice(1)).toEqual([
      "email           email                  yes, by email_verified",
      "phoneNumber     phone_number           yes, trusted",
      "givenName       given_name             no",
    ]);
  });

  it("is only the header for a mapping with nothing in it", () => {
    expect(claimTable({ ...STATE, mapping: {} }, "Acme SSO")).toHaveLength(1);
  });
});

describe("claimTable with hostile text", () => {
  const hostile: MappingState = {
    ...STATE,
    attributes: [],
    mapping: { [`name${HOSTILE}`]: `claim${HOSTILE}` },
    verified: { [`name${HOSTILE}`]: `verified${HOSTILE}` },
  };

  it("spells out every control character a file or a provider wrote", () => {
    const lines = claimTable(hostile, `Evil${HOSTILE}`).join("\n");

    expect(lines).not.toContain("\u001b");
  });

  it("keeps the characters readable", () => {
    const lines = claimTable(hostile, `Evil${HOSTILE}`).join("\n");

    expect(lines).toContain(`Evil${SPELLED}`);
  });
});

describe("ClaimQuestions.ask with hostile text", () => {
  /**
   * Walks one claim through its questions, creating an attribute for it, while
   * the provider and a property of the schema carry {@link HOSTILE}.
   *
   * @returns What the person was asked, what the choices were and what the
   *   terminal drew as written.
   */
  async function walkedThrough() {
    const talk = answering(
      "Yes, map another claim",
      "organization",
      "Text",
      "Create a new attribute",
      "employeeNumber",
      "",
      "No, keep these",
    );
    const ui = new Ui({ interactive: true, force: false });
    await asTerminal(() => {
      return new ClaimQuestions({
        ask: asker({ interactive: true, force: false }),
        show: (title, lines) => {
          ui.note(title, lines);
        },
        say: (line) => {
          ui.say(line);
        },
      }).ask(
        {
          ...STATE,
          attributes: [{ name: `bad${HOSTILE}`, type: "string", required: false, unique: false }],
        },
        `Evil${HOSTILE}`,
      );
    });
    return talk;
  }

  it("draws nothing that drives the terminal", async () => {
    const talk = await walkedThrough();

    expect(talk.shown()).not.toContain("\u001b]0;pwned");
  });

  it("labels the choice of a property by its escaped name", async () => {
    const talk = await walkedThrough();

    expect(talk.options()[3]).toContain(`bad${SPELLED}`);
  });
});
