import type { Parsed } from "@zitadel/config/idp";

import type { Questions } from "@/lib/ui";

import {
  CLAIM_TYPES,
  type ClaimEntry,
  type ClaimRequest,
  type ClaimType,
  claimsOrRefuse,
  fieldLabelFor,
  type MappingState,
  mapClaim,
  NO_CLAIM_REQUEST,
  parseClaimName,
  parseNewAttributeName,
  parseScopeList,
  parseUnusedClaim,
  standardClaimScope,
  standardClaimType,
  unmapped,
  type VerifiedEntry,
} from "./claims";

/**
 * How a claim is verified, as the question offers it.
 */
type Verification = "none" | "claim" | "trust";

/**
 * How a type is named to a person, not to a schema.
 */
const TYPE_LABELS: Readonly<Record<ClaimType, string>> = {
  string: "Text",
  number: "Number",
  integer: "Integer",
  boolean: "True or false",
};

/**
 * The answer that means "create a new attribute", which no real attribute name
 * can equal.
 */
const CREATE = Symbol("create a new attribute");

/**
 * What a person is asked about, and where it is shown.
 */
export type ClaimQuestionsRun = {
  /**
   * How a question is asked.
   */
  readonly ask: Questions;

  /**
   * Shows a titled block of lines the person reads before the next question.
   */
  readonly show: (title: string, lines: readonly string[]) => void;

  /**
   * Says one line about what was just settled.
   */
  readonly say: (line: string) => void;
};

/**
 * What one claim's questions added to the mapping.
 */
export type AddedClaim = {
  /**
   * The mapping with the claim in it.
   */
  readonly state: MappingState;

  /**
   * What the claim maps, as the command line would have carried it.
   */
  readonly entry: ClaimEntry;

  /**
   * How the property is verified, when the person said.
   */
  readonly verified: readonly VerifiedEntry[];

  /**
   * The scopes the person added for it.
   */
  readonly scopes: readonly string[];
};

/**
 * The claims a connection maps by default, as lines of a table: the user
 * attribute, the claim and who vouches for it.
 *
 * @param state - What is mapped.
 * @param provider - How the provider is named in messages.
 * @returns The header and one line for each mapped attribute, aligned.
 */
export function claimTable(state: MappingState, provider: string): readonly string[] {
  const rows = [
    ["User attribute", `Claim from "${provider}"`, "Verified"],
    ...Object.entries(state.mapping).map(([attribute, claim]) => {
      const source = state.verified[attribute];
      const verified =
        source === undefined ? "no" : source === true ? "yes, trusted" : `yes, by ${source}`;
      return [attribute, claim, verified];
    }),
  ];
  const widths = [0, 1].map((column) => {
    return Math.max(
      ...rows.map((row) => {
        return row[column]?.length ?? 0;
      }),
    );
  });
  return rows.map(([attribute, claim, verified]) => {
    return `${(attribute ?? "").padEnd(widths[0] ?? 0)}  ${(claim ?? "").padEnd(widths[1] ?? 0)}  ${verified}`;
  });
}

/**
 * Shows what a provider fills by default, then lets a person add to it.
 *
 * @remarks
 * Each claim they add is its own set of questions: the claim to read, the type
 * the provider sends it as (unless OpenID Connect defines it), the user
 * attribute it fills, the scope the provider needs before it sends it, and, for
 * a unique attribute, who vouches for the value. The attribute list offers only
 * attributes whose type holds the claim, and the claim question refuses a claim
 * already in use, so a mapping the guards would refuse cannot be built here.
 *
 * What was asked for comes back as the request the command line would have
 * carried, so both ways of asking meet in the same place. It is for a run with
 * somebody to answer.
 */
export class ClaimQuestions {
  /**
   * How the questions are asked and shown.
   */
  private readonly run: ClaimQuestionsRun;

  /**
   * Hold how the questions are asked and shown.
   *
   * @param run - Where to ask, and where to show.
   */
  constructor(run: ClaimQuestionsRun) {
    this.run = run;
  }

  /**
   * Show the default mapping, then ask for more claims until the person has
   * none left.
   *
   * @param state - What the connection maps by default.
   * @param provider - How the provider is named in messages: "Google", "Corp SSO".
   * @returns What the person asked for beyond the defaults.
   * @throws {@link ZitadelError} With `E_VALIDATION` when an answer cannot be
   *   mapped, which the questions are built not to allow.
   */
  async ask(state: MappingState, provider: string): Promise<ClaimRequest> {
    this.run.show(
      `${provider} maps these claims to user attributes by default`,
      claimTable(state, provider),
    );
    return this.askMore(state, provider);
  }

  /**
   * Ask whether another claim should be mapped, and if so which, until the
   * person says no.
   *
   * @param state - What is mapped so far.
   * @param provider - How the provider is named in messages.
   * @returns Everything asked for from here on.
   */
  private async askMore(state: MappingState, provider: string): Promise<ClaimRequest> {
    const more = await this.run.ask.select({
      name: "whether to map another claim",
      message: `Should any other claims be mapped from "${provider}"?`,
      options: [
        { value: false, label: "No, keep these" },
        { value: true, label: "Yes, map another claim" },
      ],
      initialValue: false,
    });
    if (!more) {
      return NO_CLAIM_REQUEST;
    }
    const added = await this.askClaim(state, provider);
    const rest = await this.askMore(added.state, provider);
    return {
      entries: [added.entry, ...rest.entries],
      verified: [...added.verified, ...rest.verified],
      scopes: [...new Set([...added.scopes, ...rest.scopes])],
    };
  }

  /**
   * Ask the questions for one claim, in order, and say what they mapped.
   *
   * @param before - What is mapped so far.
   * @param provider - How the provider is named in messages.
   * @returns The mapping with the claim in it, and what the person asked for.
   * @throws {@link ZitadelError} With `E_VALIDATION` when the answers cannot be
   *   mapped.
   */
  async askClaim(before: MappingState, provider: string): Promise<AddedClaim> {
    const claim = await this.run.ask.text({
      name: "claim",
      message: "Which claim should be read?",
      placeholder: "employee_id",
      parse: (value): Parsed<string> => {
        return parseUnusedClaim(before, value);
      },
    });
    const type: ClaimType =
      standardClaimType(claim) ??
      (await this.run.ask.select({
        name: "claim type",
        message: "What type of value is it?",
        options: CLAIM_TYPES.map((one) => {
          return { value: one, label: TYPE_LABELS[one] };
        }),
        initialValue: "string",
      }));
    const candidates = unmapped(before, type);
    const chosen =
      candidates.length === 0
        ? CREATE
        : await this.run.ask.select<string | typeof CREATE>({
            name: "user attribute",
            message: "Which user attribute should it map to?",
            options: [
              ...candidates.map((one) => {
                return {
                  value: one.name,
                  label: one.name,
                  hint: [
                    one.type,
                    one.required ? "required" : undefined,
                    one.unique ? "unique" : undefined,
                  ]
                    .filter((part) => {
                      return part !== undefined;
                    })
                    .join(", "),
                };
              }),
              {
                value: CREATE,
                label: "Create a new attribute",
                hint: `a ${type} property added to your user schema`,
              },
            ],
          });
    if (chosen === CREATE && candidates.length === 0) {
      this.run.say("No user attribute is free to hold it, so it needs a new one.");
    }
    const attribute =
      chosen === CREATE
        ? await this.run.ask.text({
            name: "new attribute",
            message: "What should the new attribute be called?",
            placeholder: "employeeNumber",
            parse: (value): Parsed<string> => {
              return parseNewAttributeName(
                value,
                before.attributes.map((one) => {
                  return one.name;
                }),
              );
            },
          })
        : chosen;
    const suggested = standardClaimScope(claim);
    const extra = await this.run.ask.text({
      name: "scope",
      message: `Which scope makes "${provider}" send it? Leave blank if none.`,
      parse: parseScopeList,
      initialValue: suggested !== undefined && !before.scopes.includes(suggested) ? suggested : "",
    });
    const entry: ClaimEntry = {
      attribute,
      claim,
      ...(type === "string" ? {} : { type }),
      ...(chosen === CREATE ? { create: true } : {}),
    };
    const mapped = claimsOrRefuse(mapClaim(before, entry));
    const verified =
      chosen !== CREATE && candidates.find((one) => one.name === attribute)?.unique === true
        ? await this.askVerification(before, { attribute, claim, provider })
        : [];
    this.run.say(
      `"${claim}" now maps to "${attribute}"${chosen === CREATE ? ", a new attribute in your user schema" : ""}.`,
    );
    if (chosen === CREATE) {
      this.run.say(
        `The login form will label it "${fieldLabelFor(attribute)}". To use other wording, set register.field.${attribute} and register-sso.field.${attribute} in the locales of your login page.`,
      );
    }
    return {
      state: { ...mapped, scopes: [...new Set([...mapped.scopes, ...extra])] },
      entry,
      verified,
      scopes: extra,
    };
  }

  /**
   * Ask whether the provider confirms a unique attribute, and by which claim.
   *
   * @param before - What is mapped before this claim.
   * @param about - The attribute, the claim that now fills it, and the provider.
   * @returns How the attribute is verified, or nothing when the person says it
   *   is not.
   */
  private async askVerification(
    before: MappingState,
    about: { readonly attribute: string; readonly claim: string; readonly provider: string },
  ): Promise<readonly VerifiedEntry[]> {
    const { attribute, claim, provider } = about;
    const replaced = before.verified[attribute];
    if (replaced !== undefined && before.mapping[attribute] !== claim) {
      this.run.say(
        `"${attribute}" now comes from "${claim}", so "${replaced === true ? provider : replaced}" no longer vouches for it.`,
      );
    }
    const how = await this.run.ask.select<Verification>({
      name: "verification",
      message: `Does "${provider}" confirm that ${attribute} is verified?`,
      options: [
        { value: "none", label: "No", hint: "new users confirm it themselves" },
        { value: "claim", label: "Yes, a claim says so" },
        { value: "trust", label: "Yes, trust the provider" },
      ],
      initialValue: "none",
    });
    if (how === "trust") {
      return [{ attribute, source: true }];
    }
    if (how === "none") {
      return [];
    }
    return [
      {
        attribute,
        source: await this.run.ask.text({
          name: "verifying claim",
          message: `Which claim says ${attribute} is verified?`,
          parse: parseClaimName,
          initialValue: `${claim}_verified`,
        }),
      },
    ];
  }
}
