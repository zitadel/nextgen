import { consola } from "consola";

import { ZitadelError } from "../errors";
import type { Asker } from "../input";

import {
  CLAIM_TYPES,
  type ClaimEntry,
  type ClaimRequest,
  type ClaimType,
  describeMapping,
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

/** What the developer is told before being asked for more: what is mapped already. */
function announceDefaults(state: MappingState): void {
  const lines = describeMapping(state);
  consola.info(
    lines.length === 0
      ? "No claims are mapped to the user schema yet."
      : `Claims mapped to the user schema:\n  ${lines.join("\n  ")}`,
  );
}

/**
 * Walk a person through mapping more claims, until they choose to continue.
 *
 * Each pass asks for a claim, what type the provider returns it as (unless
 * OpenID Connect defines it), the property to fill, the scope the provider
 * needs before it returns it, and, for a unique property, how the provider
 * vouches for the value. The property list offers only empty properties whose
 * type holds the claim, and the claim prompt refuses a claim already in use,
 * so a mapping that the guards would refuse cannot be built here.
 *
 * Returns what was asked for, as the request the command line would have
 * carried, so both ways of asking meet in the same place. Interactive only:
 * the caller never runs it when nobody can answer.
 */
export async function askClaims(state: MappingState, ask: Asker): Promise<ClaimRequest> {
  announceDefaults(state);
  const entries: ClaimEntry[] = [];
  const verified: VerifiedEntry[] = [];
  const scopes: string[] = [];
  let current = state;

  while (hasFillable(current)) {
    const more = await ask({
      kind: "select",
      name: "whether to map another claim",
      message: "Map another claim from the provider?",
      options: [
        { value: false, label: "Continue", hint: "keep the mapping above" },
        { value: true, label: "Map another claim" },
      ],
      initialValue: false,
    });
    if (!more) {
      break;
    }

    const snapshot = current;
    const claim = await ask({
      kind: "text",
      name: "claim",
      message: "Claim name, as the provider returns it (e.g. employee_id)",
      parse: (value) => parseUnusedClaim(snapshot, value),
    });
    const type: ClaimType =
      standardClaimType(claim) ??
      (await ask({
        kind: "select",
        name: "claim type",
        message: `How does the provider return ${claim}?`,
        options: CLAIM_TYPES.map((one) => ({ value: one, label: one })),
        initialValue: "string",
      }));

    const candidates = fillable(current, type);
    if (candidates.length === 0) {
      consola.info(`No empty property of the user schema can hold a ${type} claim.`);
      continue;
    }
    const attribute = await ask({
      kind: "select",
      name: "property",
      message: `Which property should ${claim} fill?`,
      options: candidates.map((one) => ({
        value: one.name,
        label: one.name,
        hint: [
          one.type,
          one.required ? "required" : undefined,
          one.unique ? "unique" : undefined,
          current.mapping[one.name] === undefined
            ? undefined
            : `replaces ${current.mapping[one.name]}`,
        ]
          .filter((part) => part !== undefined)
          .join(", "),
      })),
    });

    const suggested = standardClaimScope(claim);
    const extra = await ask({
      kind: "text",
      name: "scope",
      message: `Scope the provider needs to return ${claim} (blank if it needs none)`,
      parse: parseScopeList,
      initialValue: suggested !== undefined && !current.scopes.includes(suggested) ? suggested : "",
    });

    const entry: ClaimEntry = { attribute, claim, ...(type === "string" ? {} : { type }) };
    const mapped = mapClaim(current, entry);
    if (!mapped.ok) {
      throw new ZitadelError("E_VALIDATION", mapped.problem);
    }
    current = { ...mapped.value, scopes: [...new Set([...mapped.value.scopes, ...extra])] };
    entries.push(entry);
    scopes.push(...extra);

    const chosen = candidates.find((one) => one.name === attribute);
    if (chosen?.unique === true) {
      const how = await ask({
        kind: "select",
        name: "verification",
        message: `Does the provider vouch for ${attribute}? It must be unique, so an unverified value sends new users to a form to confirm it.`,
        options: [
          { value: "none" as Verification, label: "No", hint: "leave it unverified" },
          { value: "claim" as Verification, label: "Yes, a boolean claim says so" },
          { value: "trust" as Verification, label: "Yes, trust the provider" },
        ],
        initialValue: "none" as Verification,
      });
      if (how === "trust") {
        verified.push({ attribute, source: true });
      } else if (how === "claim") {
        const source = await ask({
          kind: "text",
          name: "verifying claim",
          message: `Boolean claim that says ${attribute} is verified`,
          parse: parseClaimName,
          initialValue: `${claim}_verified`,
        });
        verified.push({ attribute, source });
      }
    }
    announceDefaults(current);
  }
  return { entries, verified: [...verified], scopes: [...new Set(scopes)] };
}
