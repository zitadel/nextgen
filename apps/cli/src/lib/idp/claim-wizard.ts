import { ZitadelError } from "../errors";
import type { Cell, Wizard } from "../wizard";

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

/**
 * Show what a provider fills by default, then let a person add to it.
 *
 * Each claim they add is a branch of its own: the claim to read, the type the
 * provider sends it as (unless OpenID Connect defines it), the user attribute
 * it fills, the scope the provider needs before it sends it, and, for a unique
 * attribute, who vouches for the value. The attribute list offers only
 * attributes whose type holds the claim, and the claim prompt refuses a claim
 * already in use, so a mapping the guards would refuse cannot be built here.
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
  const entries: ClaimEntry[] = [];
  const verified: VerifiedEntry[] = [];
  const scopes: string[] = [];
  let current = state;

  wizard.say([
    `${quoted(provider)} maps these claims to user attributes by default:`,
    "",
    ...wizard.table(
      ["User attribute", `Claim from ${quoted(provider)}`, "Verified"],
      mappingRows(current),
    ),
  ]);

  while (hasFillable(current)) {
    const more = await wizard.ask({
      kind: "select",
      name: "whether to map another claim",
      message: `Should any other claims be mapped from ${quoted(provider)}?`,
      options: [
        { value: false, label: "No, keep these" },
        { value: true, label: "Yes, map another claim" },
      ],
      initialValue: false,
    });
    if (!more) {
      break;
    }

    const before = current;
    await wizard.branch("Adding a claim", async () => {
      const claim = await wizard.ask({
        kind: "text",
        name: "claim",
        message: "Which claim should be read?",
        placeholder: "employee_id",
        parse: (value) => parseUnusedClaim(before, value),
      });
      const type: ClaimType =
        standardClaimType(claim) ??
        (await wizard.ask({
          kind: "select",
          name: "claim type",
          message: "What type of value is it?",
          options: CLAIM_TYPES.map((one) => ({ value: one, label: TYPE_LABEL[one] })),
          initialValue: "string",
        }));

      const candidates = fillable(before, type);
      if (candidates.length === 0) {
        wizard.say(`No user attribute can hold a ${TYPE_LABEL[type].toLowerCase()} value.`, "warn");
        return;
      }
      const attribute = await wizard.ask({
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
      });

      const suggested = standardClaimScope(claim);
      const extra = await wizard.ask({
        kind: "text",
        name: "scope",
        message: `Which scope makes ${quoted(provider)} send it? Leave blank if none.`,
        parse: parseScopeList,
        initialValue:
          suggested !== undefined && !before.scopes.includes(suggested) ? suggested : "",
      });

      const entry: ClaimEntry = { attribute, claim, ...(type === "string" ? {} : { type }) };
      const mapped = mapClaim(before, entry);
      if (!mapped.ok) {
        throw new ZitadelError("E_VALIDATION", mapped.problem);
      }
      current = { ...mapped.value, scopes: [...new Set([...mapped.value.scopes, ...extra])] };
      entries.push(entry);
      scopes.push(...extra);

      const chosen = candidates.find((one) => one.name === attribute);
      if (chosen?.unique === true) {
        if (before.verified[attribute] !== undefined && before.mapping[attribute] !== claim) {
          wizard.say(
            `${quoted(attribute)} now comes from ${quoted(claim)}, so ${quoted(String(before.verified[attribute] === true ? provider : before.verified[attribute]))} no longer vouches for it.`,
            "warn",
          );
        }
        const how = await wizard.ask({
          kind: "select",
          name: "verification",
          message: `Does ${quoted(provider)} confirm that ${attribute} is verified?`,
          options: [
            { value: "none" as Verification, label: "No", hint: "new users confirm it themselves" },
            { value: "claim" as Verification, label: "Yes, a claim says so" },
            { value: "trust" as Verification, label: "Yes, trust the provider" },
          ],
          initialValue: "none" as Verification,
        });
        if (how === "trust") {
          verified.push({ attribute, source: true });
        } else if (how === "claim") {
          const source = await wizard.ask({
            kind: "text",
            name: "verifying claim",
            message: `Which claim says ${attribute} is verified?`,
            parse: parseClaimName,
            initialValue: `${claim}_verified`,
          });
          verified.push({ attribute, source });
        }
      }
      wizard.say(`${quoted(claim)} now maps to ${quoted(attribute)}.`, "success");
    });
  }
  return { entries, verified: [...verified], scopes: [...new Set(scopes)] };
}
