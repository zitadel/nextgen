import { type Fact, VERIFIED_FLAG } from "@/cli/commands/auth-method/sso/enable/shared";
import {
  applyRequest,
  asksForClaims,
  choiceOf,
  claimRequestFromFlags,
  claimsOrRefuse,
  seedMapping,
} from "@/lib/idp";
import { reportWarning } from "@/lib/warnings";
import { WizardStep } from "@/lib/wizard";
import { Connection } from "@/lib/zitadel";

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"flags" | "target" | "provider" | "options">;

/**
 * Reads the claims the flags map and refuses what the user schema cannot take,
 * before a secret is asked for or a file is written.
 *
 * @remarks
 * A reused connection keeps the mapping it has: it is the developer's file.
 */
export class ReadClaims extends WizardStep<
  "claims",
  Fact<"claimRequest" | "mapping" | "claims">,
  Needs
> {
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
  readonly key = "claims";

  /**
   * Apply the flags to what the provider maps by default.
   *
   * @remarks
   * Whether the connection is new is known only by looking for the one the
   * project may hold for the provider already; the change is planned once, by
   * `PlanChange`.
   *
   * @param needs - The flags, the schema, the provider and the options.
   * @returns What the flags asked for, and the mapping it makes.
   * @throws {@link ZitadelError} With `E_VALIDATION` when a claim does not fit
   *   the user schema.
   */
  async run(needs: Needs): Promise<Fact<"claimRequest" | "mapping" | "claims">> {
    const claimRequest = claimRequestFromFlags({
      claim: needs.flags.claim,
      scope: needs.flags.claimScope,
      verified: needs.flags.verifiedClaim,
    });
    const plain = Connection.forProvider(needs.provider, needs.target.schema);
    const existing = needs.target.config.connections.resolveExisting(plain, needs.options);
    if (existing !== undefined) {
      if (asksForClaims(claimRequest)) {
        reportWarning(
          `${existing.path} already exists, so the claims you gave were not applied. Edit claim_mapping in the file to change them.`,
        );
      }
      return {
        claimRequest,
        mapping: undefined,
        claims: undefined,
      };
    }
    const mapping = claimsOrRefuse(
      applyRequest(seedMapping(plain, needs.target.schema), claimRequest),
    );
    const claims = choiceOf(mapping, VERIFIED_FLAG);
    for (const note of claims.notes) {
      reportWarning(note);
    }
    return {
      claimRequest,
      mapping,
      claims,
    };
  }
}
