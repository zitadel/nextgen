import type { Parsed } from "@zitadel/config/idp";

import {
  type EnableServices,
  type Fact,
  plain,
  VERIFIED_FLAG,
} from "@/cli/commands/auth-method/sso/enable/shared";
import {
  applyRequest,
  asksForClaims,
  CLAIM_TYPES,
  type ClaimEntry,
  type ClaimRequest,
  type ClaimType,
  choiceOf,
  claimsOrRefuse,
  fits,
  type MappingState,
  mapClaim,
  NO_CLAIM_REQUEST,
  parseClaimName,
  parseNewAttributeName,
  parseScopeList,
  standardClaimType,
  type VerifiedEntry,
} from "@/lib/idp";
import { log } from "@/lib/log";
import { reportWarning } from "@/lib/warnings";
import { WizardStep } from "@/lib/wizard";
import { standardClaim } from "@/lib/zitadel";

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
 * What the step reads from what is known.
 */
type Needs = Fact<"provider" | "claimRequest" | "mapping" | "claims">;

/**
 * What the step is given by the command.
 */
type Deps = Pick<EnableServices, "ask" | "nonInteractive">;

/**
 * How a claim is verified, as the question offers it.
 */
type Verification = "none" | "claim" | "trust";

/**
 * Escapes what is wrong with an answer, which names a property or a scope that
 * came from a file or from what was typed, before the question draws it.
 *
 * @param parsed - The answer, or what is wrong with it.
 * @returns The same answer, with the problem safe to draw.
 */
function escaped<T>(parsed: Parsed<T>): Parsed<T> {
  return parsed.ok
    ? parsed
    : {
        ok: false,
        problem: plain(parsed.problem),
      };
}

/**
 * Shows what the provider fills by default and asks whether other claims should
 * be mapped, once the credentials are in.
 *
 * @remarks
 * Flags that name claims are the whole answer, as `--preset` is for its
 * question, and a run nobody can answer takes the defaults.
 *
 * Each claim the person adds is its own set of questions: the claim to read, the
 * type the provider sends it as (unless OpenID Connect defines it), the user
 * attribute it fills, the scope the provider needs before it sends it, and, for
 * a unique attribute, who vouches for the value. The attribute list offers only
 * attributes whose type holds the claim, and the claim question refuses a claim
 * already in use, so a mapping the guards would refuse cannot be built here.
 *
 * Everything the questions show that a file or a provider wrote, such as a
 * provider's name or a claim, is escaped for the terminal where it is worded,
 * while the answers keep the raw values the mapping is made of. What was asked
 * for comes back as the request the command line would have carried, so both
 * ways of asking meet in the same place.
 */
export class AskClaims extends WizardStep<"answered", Fact<"answered">, Needs> {
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
  readonly key = "answered";

  /**
   * What the command gives the step.
   */
  private readonly deps: Deps;

  /**
   * @param deps - What the command gives the step.
   */
  constructor(deps: Deps) {
    super();
    this.deps = deps;
  }

  /**
   * Ask for the claims to map, and say what the answers changed that the flags
   * had not.
   *
   * @param needs - The provider and what the flags settled.
   * @returns What the connection is written with: what the flags settled when
   *   nothing was asked, otherwise what the answers settled.
   * @throws {@link ZitadelError} With `E_VALIDATION` when an answer cannot be
   *   mapped, which the questions are built not to allow.
   */
  async run(needs: Needs): Promise<Fact<"answered">> {
    if (
      needs.mapping === undefined ||
      asksForClaims(needs.claimRequest) ||
      this.deps.nonInteractive
    ) {
      return {
        answered: needs.claims,
      };
    }
    const state = needs.mapping;
    const provider = needs.provider.displayName;
    const rows = [
      ["User attribute", `Claim from "${plain(provider)}"`, "Verified"],
      ...Object.entries(state.mapping).map(([attribute, claim]) => {
        const source = state.verified[attribute];
        const verified =
          source === undefined
            ? "no"
            : source === true
              ? "yes, trusted"
              : `yes, by ${plain(source)}`;
        return [plain(attribute), plain(claim), verified];
      }),
    ];
    const widths = [0, 1].map((column) => {
      return Math.max(
        ...rows.map((row) => {
          return row[column]?.length ?? 0;
        }),
      );
    });
    log.info(
      [
        `${plain(provider)} maps these claims to user attributes by default`,
        ...rows.map(([attribute, claim, verified]) => {
          return `${(attribute ?? "").padEnd(widths[0] ?? 0)}  ${(claim ?? "").padEnd(widths[1] ?? 0)}  ${verified}`;
        }),
      ].join("\n"),
    );
    const request = await this.askMore(state, provider);
    const answered = choiceOf(claimsOrRefuse(applyRequest(state, request)), VERIFIED_FLAG);
    const heard = new Set(needs.claims?.notes);
    for (const note of answered.notes) {
      if (!heard.has(note)) {
        reportWarning(note);
      }
    }
    return {
      answered,
    };
  }

  /**
   * Ask whether another claim should be mapped, and if so ask the questions for
   * it and say what they mapped, until the person says no.
   *
   * @remarks
   * A claim of a type could fill the properties whose type holds it that no claim of this request
   * has mapped yet: those no claim fills, and those only a default fills, which the claim would
   * replace. A claim name no property is filled from yet is the one asked for.
   *
   * @param before - What is mapped so far.
   * @param provider - How the provider is named in messages: "Google", "Corp SSO".
   * @returns Everything asked for from here on.
   * @throws {@link ZitadelError} With `E_VALIDATION` when the answers cannot be
   *   mapped.
   */
  private async askMore(before: MappingState, provider: string): Promise<ClaimRequest> {
    const more = await this.deps.ask.select({
      name: "whether to map another claim",
      message: `Should any other claims be mapped from "${plain(provider)}"?`,
      options: [
        {
          value: false,
          label: "No, keep these",
        },
        {
          value: true,
          label: "Yes, map another claim",
        },
      ],
      initialValue: false,
    });
    if (!more) {
      return NO_CLAIM_REQUEST;
    }
    const claim = await this.deps.ask.text({
      name: "claim",
      message: "Which claim should be read?",
      placeholder: "employee_id",
      parse: (value): Parsed<string> => {
        const named = parseClaimName(value);
        if (!named.ok) {
          return escaped(named);
        }
        const holder = Object.entries(before.mapping).find(([, used]) => {
          return used === named.value;
        })?.[0];
        return escaped(
          holder === undefined
            ? named
            : {
                ok: false,
                problem: `${named.value} already fills ${holder}: a claim fills one property.`,
              },
        );
      },
    });
    const type: ClaimType =
      standardClaimType(claim) ??
      (await this.deps.ask.select({
        name: "claim type",
        message: "What type of value is it?",
        options: CLAIM_TYPES.map((one) => {
          return {
            value: one,
            label: TYPE_LABELS[one],
          };
        }),
        initialValue: "string",
      }));
    const candidates = before.attributes.filter((attribute) => {
      return (
        attribute.type !== undefined &&
        fits(type, attribute.type) &&
        !before.explicit.includes(attribute.name)
      );
    });
    if (candidates.length === 0 && type !== "string") {
      log.info(
        `No user attribute holds a ${type} claim, and the login form submits a new attribute as text. Add a ${type} property to your user schema, then map "${plain(claim)}" to it with --claim.`,
      );
      return this.askMore(before, provider);
    }
    const chosen =
      candidates.length === 0
        ? CREATE
        : await this.deps.ask.select<string | typeof CREATE>({
            name: "user attribute",
            message: "Which user attribute should it map to?",
            options: [
              ...candidates.map((one) => {
                return {
                  value: one.name,
                  label: plain(one.name),
                  hint: [
                    one.type,
                    Object.hasOwn(before.mapping, one.name)
                      ? `replaces ${plain(before.mapping[one.name] ?? "")}`
                      : undefined,
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
              } as const,
            ].filter((option) => {
              return type === "string" || option.value !== CREATE;
            }),
          });
    if (chosen === CREATE && candidates.length === 0) {
      log.info("No user attribute is free to hold it, so it needs a new one.");
    }
    const attribute =
      chosen === CREATE
        ? await this.deps.ask.text({
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
    const suggested = standardClaim(claim)?.scope;
    const extra = await this.deps.ask.text({
      name: "scope",
      message: `Which scope makes "${plain(provider)}" send it? Leave blank if none.`,
      parse: (value): Parsed<readonly string[]> => {
        return escaped(parseScopeList(value));
      },
      initialValue: suggested !== undefined && !before.scopes.includes(suggested) ? suggested : "",
    });
    const entry: ClaimEntry = {
      attribute,
      claim,
      ...(type === "string" ? {} : { type }),
      ...(chosen === CREATE ? { create: true } : {}),
    };
    const mapped = claimsOrRefuse(mapClaim(before, entry));
    const unique =
      chosen !== CREATE &&
      candidates.some((one) => {
        return one.name === attribute && one.unique;
      });
    const replaced = before.verified[attribute];
    if (unique && replaced !== undefined && before.mapping[attribute] !== claim) {
      log.info(
        `"${plain(attribute)}" now comes from "${plain(claim)}", so "${plain(replaced === true ? provider : replaced)}" no longer vouches for it.`,
      );
    }
    const how = unique
      ? await this.deps.ask.select<Verification>({
          name: "verification",
          message: `Does "${plain(provider)}" confirm that ${plain(attribute)} is verified?`,
          options: [
            {
              value: "none",
              label: "No",
              hint: "new users confirm it themselves",
            },
            {
              value: "claim",
              label: "Yes, a claim says so",
            },
            {
              value: "trust",
              label: "Yes, trust the provider",
            },
          ],
          initialValue: "none",
        })
      : "none";
    const verified: readonly VerifiedEntry[] =
      how === "trust"
        ? [
            {
              attribute,
              source: true,
            },
          ]
        : how === "none"
          ? []
          : [
              {
                attribute,
                source: await this.deps.ask.text({
                  name: "verifying claim",
                  message: `Which claim says ${plain(attribute)} is verified?`,
                  parse: parseClaimName,
                  initialValue: `${claim}_verified`,
                }),
              },
            ];
    log.info(
      `"${plain(claim)}" now maps to "${plain(attribute)}"${chosen === CREATE ? ", a new attribute in your user schema" : ""}.`,
    );
    if (chosen === CREATE) {
      const words = attribute
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[_.-]+/g, " ")
        .trim()
        .toLowerCase();
      const label = words === "" ? words : `${words[0]?.toUpperCase()}${words.slice(1)}`;
      log.info(
        `The login form will label it "${plain(label)}". To use other wording, set register.field.${plain(attribute)} and register-sso.field.${plain(attribute)} in the locales of your login page.`,
      );
    }
    const rest = await this.askMore(
      {
        ...mapped,
        scopes: [...new Set([...mapped.scopes, ...extra])],
      },
      provider,
    );
    return {
      entries: [entry, ...rest.entries],
      verified: [...verified, ...rest.verified],
      scopes: [...new Set([...extra, ...rest.scopes])],
    };
  }
}
