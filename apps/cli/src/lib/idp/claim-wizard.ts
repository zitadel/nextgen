import { ZitadelError } from "../errors";
import { type Cell, GoBack, type Step, type Wizard } from "../wizard";

import {
  CLAIM_TYPES,
  type ClaimEntry,
  type ClaimRequest,
  type ClaimType,
  fillable,
  hasFillable,
  mapClaim,
  type MappingState,
  parseClaimName,
  parseScopeList,
  parseUnusedClaim,
  standardClaimScope,
  standardClaimType,
  type VerifiedEntry,
} from "./claims";

type Verification = "none" | "claim" | "trust";

/** How a type is named to a person, not to a schema. */
const TYPE_LABEL: Readonly<Record<ClaimType, string>> = {
  string: "Text",
  number: "Number",
  integer: "Integer",
  boolean: "True or false",
};

const quoted = (name: string): string => `"${name}"`;

/** The mapping as table rows: attribute, claim, and who vouches for it. */
function mappingRows(state: MappingState): Cell[][] {
  return Object.entries(state.mapping).map(([attribute, claim]) => {
    const source = state.verified[attribute];
    const verified: Cell =
      source === undefined
        ? { text: "no", tone: "muted" }
        : { text: source === true ? "yes, trusted" : `yes, by ${source}`, tone: "success" };
    return [attribute, claim, verified];
  });
}

/** What one claim's questions collect, a step at a time. */
type Draft = {
  claim?: string;
  type?: ClaimType;
  attribute?: string;
  scopes?: string[];
  verification?: Verification;
  verifyingClaim?: string;
};

/** Raised inside a claim's questions when no attribute can hold it, to leave the branch. */
class NothingToFill extends Error {}

/** What adding a claim changed, so that going back can take it out again. */
type Added = {
  before: MappingState;
  entry: ClaimEntry;
  verified: VerifiedEntry[];
  scopes: string[];
};

/**
 * Show what a provider fills by default, then let a person add to it.
 *
 * Each claim they add is a branch of its own, asked as steps they can go back
 * through: the claim to read, the type the provider sends it as (unless
 * OpenID Connect defines it), the user attribute it fills, the scope the
 * provider needs before it sends it, and, for a unique attribute, who vouches
 * for the value. The attribute list offers only attributes whose type holds
 * the claim, and the claim prompt refuses a claim already in use, so a mapping
 * the guards would refuse cannot be built here. Going back from "any other
 * claims?" takes the last claim out and asks it again.
 *
 * Returns what was asked for as the request the command line would have
 * carried, so both ways of asking meet in the same place. Interactive only:
 * the caller never runs it when nobody can answer.
 *
 * @param provider - How the provider is named in messages: "Google", "Corp SSO".
 */
export async function askClaims(
  state: MappingState,
  wizard: Wizard,
  provider: string,
): Promise<ClaimRequest> {
  const added: Added[] = [];
  let current = state;

  wizard.say([
    `${quoted(provider)} maps these claims to user attributes by default:`,
    "",
    ...wizard.table(
      ["User attribute", `Claim from ${quoted(provider)}`, "Verified"],
      mappingRows(current),
    ),
  ]);

  let retake = false;
  while (hasFillable(current)) {
    if (!retake) {
      let more: boolean;
      try {
        more = await wizard.ask({
          kind: "select",
          name: "whether to map another claim",
          message: `Should any other claims be mapped from ${quoted(provider)}?`,
          options: [
            { value: false, label: "No, keep these" },
            { value: true, label: "Yes, map another claim" },
          ],
          initialValue: false,
        });
      } catch (error) {
        const last = added.pop();
        if (!(error instanceof GoBack) || last === undefined) {
          throw error;
        }
        current = last.before;
        retake = true;
        continue;
      }
      if (!more) {
        break;
      }
    }
    retake = false;

    const before = current;
    try {
      const draft = await wizard.branch("Adding a claim", () =>
        wizard.steps<Draft>({}, claimSteps(wizard, before, provider)),
      );
      const result = commit(before, draft as Required<Pick<Draft, "claim" | "attribute">> & Draft);
      current = result.state;
      added.push({ before, entry: result.entry, verified: result.verified, scopes: result.scopes });
      wizard.say(
        `${quoted(result.entry.claim)} now maps to ${quoted(result.entry.attribute)}.`,
        "success",
      );
    } catch (error) {
      if (error instanceof NothingToFill) {
        continue;
      }
      if (error instanceof GoBack) {
        // Back from the first question of a claim: ask whether to map one at all.
        continue;
      }
      throw error;
    }
  }
  return {
    entries: added.map((one) => one.entry),
    verified: added.flatMap((one) => one.verified),
    scopes: [...new Set(added.flatMap((one) => one.scopes))],
  };
}

/** The questions for one claim, in order. A step that has nothing to ask is skipped. */
function claimSteps(wizard: Wizard, before: MappingState, provider: string): Step<Draft>[] {
  return [
    async (draft) => ({
      ...draft,
      claim: await wizard.ask({
        kind: "text",
        name: "claim",
        message: "Which claim should be read?",
        placeholder: "employee_id",
        parse: (value) => parseUnusedClaim(before, value),
      }),
    }),
    async (draft) => {
      const claim = draft.claim as string;
      return {
        ...draft,
        type:
          standardClaimType(claim) ??
          (await wizard.ask({
            kind: "select",
            name: "claim type",
            message: "What type of value is it?",
            options: CLAIM_TYPES.map((one) => ({ value: one, label: TYPE_LABEL[one] })),
            initialValue: "string",
          })),
      };
    },
    async (draft) => {
      const type = draft.type as ClaimType;
      const candidates = fillable(before, type);
      if (candidates.length === 0) {
        wizard.say(`No user attribute can hold a ${TYPE_LABEL[type].toLowerCase()} value.`, "warn");
        throw new NothingToFill();
      }
      return {
        ...draft,
        attribute: await wizard.ask({
          kind: "select",
          name: "user attribute",
          message: "Which user attribute should it map to?",
          options: candidates.map((one) => ({
            value: one.name,
            label: one.name,
            hint: [
              one.type,
              one.required ? "required" : undefined,
              one.unique ? "unique" : undefined,
              before.mapping[one.name] === undefined
                ? undefined
                : `now from ${quoted(before.mapping[one.name] as string)}`,
            ]
              .filter((part) => part !== undefined)
              .join(", "),
          })),
        }),
      };
    },
    async (draft) => {
      const suggested = standardClaimScope(draft.claim as string);
      return {
        ...draft,
        scopes: await wizard.ask({
          kind: "text",
          name: "scope",
          message: `Which scope makes ${quoted(provider)} send it? Leave blank if none.`,
          parse: parseScopeList,
          initialValue:
            suggested !== undefined && !before.scopes.includes(suggested) ? suggested : "",
        }),
      };
    },
    async (draft) => {
      const attribute = before.attributes.find((one) => one.name === draft.attribute);
      if (attribute?.unique !== true) {
        return draft;
      }
      const name = draft.attribute as string;
      const claim = draft.claim as string;
      if (before.verified[name] !== undefined && before.mapping[name] !== claim) {
        wizard.say(
          `${quoted(name)} now comes from ${quoted(claim)}, so ${quoted(String(before.verified[name] === true ? provider : before.verified[name]))} no longer vouches for it.`,
          "warn",
        );
      }
      const verification = await wizard.ask({
        kind: "select",
        name: "verification",
        message: `Does ${quoted(provider)} confirm that ${name} is verified?`,
        options: [
          { value: "none" as Verification, label: "No", hint: "new users confirm it themselves" },
          { value: "claim" as Verification, label: "Yes, a claim says so" },
          { value: "trust" as Verification, label: "Yes, trust the provider" },
        ],
        initialValue: "none" as Verification,
      });
      if (verification !== "claim") {
        return { ...draft, verification };
      }
      return {
        ...draft,
        verification,
        verifyingClaim: await wizard.ask({
          kind: "text",
          name: "verifying claim",
          message: `Which claim says ${name} is verified?`,
          parse: parseClaimName,
          initialValue: `${claim}_verified`,
        }),
      };
    },
  ];
}

/** Apply a finished draft to the mapping. */
function commit(
  before: MappingState,
  draft: Required<Pick<Draft, "claim" | "attribute">> & Draft,
): { state: MappingState; entry: ClaimEntry; verified: VerifiedEntry[]; scopes: string[] } {
  const type = draft.type ?? "string";
  const entry: ClaimEntry = {
    attribute: draft.attribute,
    claim: draft.claim,
    ...(type === "string" ? {} : { type }),
  };
  const mapped = mapClaim(before, entry);
  if (!mapped.ok) {
    throw new ZitadelError("E_VALIDATION", mapped.problem);
  }
  const scopes = draft.scopes ?? [];
  const verified: VerifiedEntry[] =
    draft.verification === "trust"
      ? [{ attribute: draft.attribute, source: true }]
      : draft.verification === "claim" && draft.verifyingClaim !== undefined
        ? [{ attribute: draft.attribute, source: draft.verifyingClaim }]
        : [];
  return {
    state: { ...mapped.value, scopes: [...new Set([...mapped.value.scopes, ...scopes])] },
    entry,
    verified,
    scopes,
  };
}
