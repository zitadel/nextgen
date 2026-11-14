import { describe, expect, it } from "vitest";

import { AskClaims } from "@/cli/commands/auth-method/sso/enable/steps/ask-claims";
import { type MappingState, NO_CLAIM_REQUEST } from "@/lib/idp";
import { asker } from "@/lib/input";
import { displayName } from "@tests/helpers/idp-values";
import { anAcmeSsoProvider } from "@tests/helpers/connections";
import { type Answer, answering } from "@tests/helpers/keyboard";
import { recordLog } from "@tests/helpers/log";
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

/**
 * What the step reads from what is known.
 */
type Needs = Parameters<AskClaims["run"]>[0];

/**
 * What a run of the step asked for, and everything it said.
 */
type Walk = Readonly<{
  /**
   * What the person was asked and what the terminal drew.
   */
  talk: ReturnType<typeof answering>;

  /**
   * What the step answered with.
   */
  result: Awaited<ReturnType<AskClaims["run"]>>;

  /**
   * Everything the step said with `log`, one line after another.
   */
  said: string;
}>;

describe("AskClaims", () => {
  /**
   * What the step is given: a provider named `name`, whose claims are mapped as
   * `state` says, with nothing asked for on the command line.
   *
   * @param state - What is mapped by default.
   * @param name - How the provider is named in messages.
   * @returns What the step reads.
   */
  function needsFor(state: MappingState, name = "Acme SSO"): Needs {
    return {
      provider: anAcmeSsoProvider({ displayName: displayName(name) }),
      claimRequest: NO_CLAIM_REQUEST,
      mapping: state,
      claims: undefined,
    };
  }

  /**
   * Runs the step against a person who gives the answers in order.
   *
   * @param needs - What the step reads.
   * @param answers - What the person answers, one to each question.
   * @returns What they saw, what the step answered with and what it said.
   */
  async function walked(needs: Needs, ...answers: readonly Answer[]): Promise<Walk> {
    const talk = answering(...answers);
    const recording = recordLog();
    try {
      const result = await asTerminal(() => {
        return new AskClaims({
          ask: asker({ interactive: true, force: false }),
          nonInteractive: false,
        }).run(needs);
      });
      return {
        talk,
        result,
        said: recording.said
          .map((line) => {
            return line.text;
          })
          .join("\n"),
      };
    } finally {
      recording.stop();
    }
  }

  describe("the table of what is mapped by default", () => {
    it("heads the columns with the provider the claims come from", async () => {
      const { said } = await walked(needsFor(STATE), "No, keep these");

      expect(said.split("\n")[1]).toBe('User attribute  Claim from "Acme SSO"  Verified');
    });

    it("says who vouches for each attribute, aligned under the header", async () => {
      const { said } = await walked(needsFor(STATE), "No, keep these");

      expect(said.split("\n").slice(2)).toEqual([
        "email           email                  yes, by email_verified",
        "phoneNumber     phone_number           yes, trusted",
        "givenName       given_name             no",
      ]);
    });

    it("is only the header for a mapping with nothing in it", async () => {
      const { said } = await walked(needsFor({ ...STATE, mapping: {} }), "No, keep these");

      expect(said.split("\n")).toHaveLength(2);
    });

    it("names the provider the claims come from above the table", async () => {
      const { said } = await walked(needsFor(STATE), "No, keep these");

      expect(said.split("\n")[0]).toBe("Acme SSO maps these claims to user attributes by default");
    });
  });

  describe("the table with hostile text", () => {
    const hostile: MappingState = {
      ...STATE,
      attributes: [],
      mapping: { [`name${HOSTILE}`]: `claim${HOSTILE}` },
      verified: { [`name${HOSTILE}`]: `verified${HOSTILE}` },
    };

    it("spells out every control character a file or a provider wrote", async () => {
      const { said } = await walked(needsFor(hostile, `Evil${HOSTILE}`), "No, keep these");

      expect(said).not.toContain("\u001b");
    });

    it("keeps the characters readable", async () => {
      const { said } = await walked(needsFor(hostile, `Evil${HOSTILE}`), "No, keep these");

      expect(said).toContain(`Evil${SPELLED}`);
    });
  });

  describe("the questions with hostile text", () => {
    /**
     * Walks one claim through its questions, creating an attribute for it, while
     * the provider and a property of the schema carry {@link HOSTILE}.
     *
     * @returns What the person was asked, what the choices were and what the
     *   terminal drew and the step said, as written.
     */
    async function walkedThrough() {
      return walked(
        needsFor(
          {
            ...STATE,
            attributes: [{ name: `bad${HOSTILE}`, type: "string", required: false, unique: false }],
          },
          `Evil${HOSTILE}`,
        ),
        "Yes, map another claim",
        "organization",
        "Text",
        "Create a new attribute",
        "employeeNumber",
        "",
        "No, keep these",
      );
    }

    it("draws nothing that drives the terminal", async () => {
      const { talk, said } = await walkedThrough();

      expect(`${talk.shown()}${said}`).not.toContain("\u001b]0;pwned");
    });

    it("labels the choice of a property by its escaped name", async () => {
      const { talk } = await walkedThrough();

      expect(talk.options()[3]).toContain(`bad${SPELLED}`);
    });

    it("refuses a claim a property already uses, naming that property escaped", async () => {
      const { talk } = await walked(
        needsFor({ ...STATE, mapping: { [`name${HOSTILE}`]: "employee_id" }, verified: {} }),
        "Yes, map another claim",
        "employee_id",
        "organization",
        "Text",
        "employeeNumber",
        "",
        "No, keep these",
      );

      expect(talk.shown()).toContain(
        `employee_id already fills name${SPELLED}: a claim fills one property.`,
      );
    });

    it("still says why a scope is refused", async () => {
      const { talk } = await walked(
        needsFor({ ...STATE, attributes: [] }),
        "Yes, map another claim",
        "organization",
        "Text",
        "employeeNumber",
        'bad"scope',
        "",
        "No, keep these",
      );

      expect(talk.shown()).toContain('bad"scope is not a valid scope');
    });
  });

  describe("a schema whose only property a default fills", () => {
    it("lets a claim replace the default instead of forcing a new attribute", async () => {
      const { result } = await walked(
        needsFor({
          ...STATE,
          attributes: [{ name: "email", type: "string", required: true, unique: false }],
          mapping: { email: "email" },
          verified: {},
        }),
        "Yes, map another claim",
        "mail",
        "Text",
        "email",
        "",
        "No, keep these",
      );

      expect(result.answered).toMatchObject({
        mapping: { email: "mail" },
        created: [],
      });
    });
  });

  describe("a claim that is not text, when no attribute holds it", () => {
    it("says a new attribute would be text and moves on without creating one", async () => {
      const { said, result } = await walked(
        needsFor({ ...STATE, mapping: {}, verified: {} }),
        "Yes, map another claim",
        "employee_id",
        "Integer",
        "No, keep these",
      );

      expect([
        said.includes("the login form submits a new attribute as text"),
        result.answered,
      ]).toEqual([true, expect.objectContaining({ created: [] })]);
    });
  });

  describe("a new attribute", () => {
    it.each([
      ["employeeNumber", "Employee number"],
      ["staff_no", "Staff no"],
      ["email", "Email"],
      ["dateOfBirth", "Date of birth"],
      ["address2Line", "Address2 line"],
      ["x", "X"],
    ])("is labelled on the login form as %s is: %s", async (name, label) => {
      const { said } = await walked(
        needsFor({ ...STATE, mapping: {}, verified: {} }),
        "Yes, map another claim",
        "organization",
        "Text",
        name,
        "",
        "No, keep these",
      );

      expect(said).toContain(`The login form will label it "${label}".`);
    });
  });
});
