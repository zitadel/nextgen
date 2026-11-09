/**
 * The SSO rules: user schemas, login flows and connection files read
 * together.
 *
 * No single file can show that a flow step offers a provider its schema does
 * not list, or that a schema lists a provider with no connection file; those
 * mistakes only show when the files are read together. Every message names
 * the file and, where it applies, the steps and the slug or key at fault, and
 * what to change.
 *
 * Each mistake is reported once, at its cause: a typo is named with what it
 * most likely meant, and what follows from it is not reported again.
 */

import type { Connection } from "@/lib/zitadel/resources/connections/connection";
import type { ClaimRead } from "@/lib/zitadel/resources/connections/types";
import type { Step } from "@/lib/zitadel/resources/flows/step";
import { PROVIDER_OUTCOMES, type ProviderOutcome } from "@/lib/zitadel/resources/flows/types";
import { claimName, type PropertyName } from "@/lib/zitadel/names";
import type { UserSchema } from "@/lib/zitadel/resources/schemas/schema";
import type { ZitadelConfig } from "@/lib/zitadel/config";
import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";
import { fits, isStandardScope, standardClaim } from "@/lib/zitadel/rules/claims";
import { closest, didYouMean } from "@/lib/zitadel/utils/spelling";

/**
 * The outcome every step offering a provider must route, and the only one a
 * step offering only providers that never create users needs.
 */
const SIGNED_IN_OUTCOMES = ["sso_authenticated"] as const satisfies readonly ProviderOutcome[];

/**
 * Names that are not standard claims but are, wherever they appear, an
 * account name a user can change.
 */
const MUTABLE_SUBJECTS: ReadonlySet<string> = new Set(["login", "username"]);

/**
 * A Unicode space at either end of a name.
 *
 * @remarks
 * The set Go's `strings.TrimSpace` trims, so both sides agree.
 */
const EDGE_SPACE = /^\p{White_Space}|\p{White_Space}$/u;

/**
 * A name in quotes, as every message prints one.
 *
 * @param value - The name.
 * @returns The name in double quotes.
 */
function quote(value: string): string {
  return JSON.stringify(value);
}

/**
 * "a" or "an" before a type name.
 *
 * @param word - The type name.
 * @returns The article.
 */
function article(word: string): string {
  if (/^[aeiou]/.test(word)) {
    return "an";
  }
  return "a";
}

/**
 * A connection that stands for its slug, with what the rules ask about it.
 */
type Standing = {
  /**
   * The connection, the first file in path order with its slug.
   */
  readonly connection: Connection;

  /**
   * The slug it stands for, as the file writes it.
   */
  readonly slug: string;

  /**
   * The schemas that list the slug, which are the ones that consume its
   * mapping.
   */
  readonly listing: readonly UserSchema[];
};

/**
 * The connections that stand for their slug: the first file in path order
 * with each slug. A second file claiming one is reported once, as a duplicate.
 *
 * @param config - The configuration.
 * @returns Each such connection, with the schemas that list it.
 */
function standing(config: ZitadelConfig): readonly Standing[] {
  return config.connections.all.flatMap((connection) => {
    const slug = connection.slug;
    if (config.connections.find(slug) !== connection) {
      return [];
    }
    return [{ connection, slug, listing: config.schemas.listOffering(slug) }];
  });
}

/**
 * The claims a connection reads by name: its mappings, then its
 * verifications that name a claim rather than always verify.
 *
 * @param connection - The connection.
 * @returns Each claim and the block it is read in.
 */
function claimReads(connection: Connection): readonly ClaimRead[] {
  const mapped = connection.mappings.map((row): ClaimRead => {
    return { field: "claim_mapping", claim: claimName(row.claim) };
  });
  const verified = connection.verifications.flatMap((row): readonly ClaimRead[] => {
    if (typeof row.claim !== "string") {
      return [];
    }
    return [{ field: "verified_claims", claim: claimName(row.claim) }];
  });
  return [...mapped, ...verified];
}

/**
 * Whether no schema that lists a connection defines a property, so a mapping
 * into it is never read. Never true for a connection no schema lists, which
 * has nothing to be judged against.
 *
 * @param entry - The connection and the schemas that list it.
 * @param property - The property's name.
 * @returns Whether the property cannot be read.
 */
function unreadable(entry: Standing, property: PropertyName): boolean {
  if (entry.listing.length === 0) {
    return false;
  }
  return !entry.listing.some((schema) => {
    return schema.has(property);
  });
}

/**
 * The properties of the schemas that list a connection.
 *
 * @param entry - The connection and the schemas that list it.
 * @returns Their property names.
 */
function readableProperties(entry: Standing): readonly PropertyName[] {
  return entry.listing.flatMap((schema) => {
    return schema.propertyNames;
  });
}

/**
 * The outcomes a step offering providers must route but does not. A provider
 * that never creates users never returns an unknown identity, so a step that
 * offers only such providers needs only `sso_authenticated`.
 *
 * @param config - The configuration.
 * @param step - The step.
 * @returns The outcomes it is missing.
 */
function unroutedOutcomes(config: ZitadelConfig, step: Step): readonly ProviderOutcome[] {
  const offersCreation = step.providers.some((slug) => {
    return config.connections.find(slug)?.createsUsers ?? true;
  });
  const required: readonly ProviderOutcome[] = offersCreation
    ? PROVIDER_OUTCOMES
    : SIGNED_IN_OUTCOMES;
  return required.filter((outcome) => {
    return !step.routes.has(outcome);
  });
}

/**
 * The providers a list names more than once, which offers their button twice.
 *
 * @param providers - The providers, as listed.
 * @returns Each repeated provider once, in the order first repeated.
 */
function repeatedProviders(providers: readonly string[]): readonly string[] {
  return [
    ...new Set(
      providers.filter((provider, index) => {
        return providers.indexOf(provider) !== index;
      }),
    ),
  ];
}

/**
 * The slugs some connection stands for.
 *
 * @param config - The configuration.
 * @returns The slugs.
 */
function knownSlugs(config: ZitadelConfig): readonly string[] {
  return standing(config).map((entry) => {
    return entry.slug;
  });
}

/**
 * Whether a connection file its contract refuses holds a slug.
 *
 * @remarks
 * Such a file is no connection, so nothing resolves to it, but it is there:
 * the contract finding already says what is wrong with it, and telling the
 * developer to add a file that exists would be wrong.
 *
 * @param config - The configuration.
 * @param slug - The slug, as a schema or a flow writes it.
 * @returns Whether a broken connection file holds the slug in its body.
 */
function heldByBrokenConnection(config: ZitadelConfig, slug: string): boolean {
  return config.broken.some((file) => {
    return file.kind === "connection" && file.body.slug === slug;
  });
}

/**
 * Every SSO rule, in the order they report.
 */
export const SSO_RULES: readonly Rule[] = [
  defineRule({
    id: "sso/duplicate-slug",
    severity: "error",
    each: (config) => {
      return config.connections.all.flatMap((connection) => {
        const first = config.connections.find(connection.slug);
        if (first === undefined || first === connection) {
          return [];
        }
        return [{ connection, slug: connection.slug, first }];
      });
    },
    file: (fact) => {
      return fact.connection.path;
    },
    says: (fact) => {
      return `connection slug ${quote(fact.slug)} is also used by ${fact.first.path}. A slug names one connection: change the slug here, or delete one of the two files.`;
    },
  }),

  defineRule({
    id: "sso/shared-variable",
    severity: "error",
    each: (config) => {
      const uses = config.connections.all.flatMap((connection) => {
        const credentials = connection.credentials;
        if (credentials === undefined) {
          return [];
        }
        return [credentials.clientId, credentials.clientSecret].flatMap((credential) => {
          if (credential.kind === "literal") {
            return [];
          }
          return [{ connection, field: credential.field, variable: credential.variable }];
        });
      });
      return uses.flatMap((use) => {
        const owner = uses.find((candidate) => {
          return candidate.variable === use.variable;
        });
        if (owner === undefined) {
          return [];
        }
        return [{ use, owner }];
      });
    },
    when: (fact) => {
      return fact.owner.connection !== fact.use.connection;
    },
    file: (fact) => {
      return fact.use.connection.path;
    },
    says: (fact) => {
      return `${fact.use.field} names the variable ${fact.use.variable}, which ${fact.owner.connection.path} also uses (as its ${fact.owner.field}). Give each connection its own variable so one cannot overwrite the other.`;
    },
  }),

  defineRule({
    id: "sso/duplicate-provider",
    severity: "error",
    each: (config) => {
      return config.schemas.all.flatMap((schema) => {
        return repeatedProviders(schema.providers).map((slug) => {
          return { schema, slug };
        });
      });
    },
    file: (fact) => {
      return fact.schema.path;
    },
    slug: (fact) => {
      return fact.slug;
    },
    says: (fact) => {
      return `sso.providers lists ${quote(fact.slug)} more than once. List each provider once.`;
    },
  }),

  defineRule({
    id: "sso/duplicate-provider",
    severity: "error",
    each: (config) => {
      return config.flows.all.flatMap((flow) => {
        return flow.steps.flatMap((step) => {
          return repeatedProviders(step.providers).map((slug) => {
            return { flow, step, slug };
          });
        });
      });
    },
    file: (fact) => {
      return fact.flow.path;
    },
    steps: {
      step: (fact) => {
        return fact.step.name;
      },
      cause: (fact) => {
        return fact.slug;
      },
    },
    says: (fact, where) => {
      return `${where}: sso_providers lists ${quote(fact.slug)} more than once, which offers its button twice. List each provider once.`;
    },
  }),

  defineRule({
    id: "sso/connection-resolves",
    severity: "error",
    each: (config) => {
      const known = knownSlugs(config);
      return config.schemas.all.flatMap((schema) => {
        return [...new Set(schema.providers)].map((slug) => {
          return {
            schema,
            slug,
            known,
            connection: config.connections.find(slug),
            broken: heldByBrokenConnection(config, slug),
          };
        });
      });
    },
    when: (fact) => {
      return fact.connection === undefined && !fact.broken;
    },
    file: (fact) => {
      return fact.schema.path;
    },
    slug: (fact) => {
      return fact.slug;
    },
    says: (fact) => {
      return `sso.providers lists ${quote(fact.slug)} but there is no connection file with that slug under .zitadel/idps/.${didYouMean(fact.slug, fact.known)} Add the file, or remove ${quote(fact.slug)} from sso.providers.`;
    },
  }),

  defineRule({
    id: "sso/connection-resolves",
    severity: "error",
    each: (config) => {
      const known = knownSlugs(config);
      return config.flows.offers.map((offer) => {
        return {
          ...offer,
          known,
          schema: config.flows.findSchemaOf(offer.flow),
          broken: heldByBrokenConnection(config, offer.slug),
        };
      });
    },
    // A provider the flow's schema also lists is reported once, on the
    // schema, since one missing file is one mistake.
    when: (fact) => {
      return (
        fact.connection === undefined && !fact.broken && fact.schema?.lists(fact.slug) !== true
      );
    },
    file: (fact) => {
      return fact.flow.path;
    },
    slug: (fact) => {
      return fact.slug;
    },
    steps: {
      step: (fact) => {
        return fact.step.name;
      },
      cause: (fact) => {
        return fact.slug;
      },
    },
    says: (fact, where) => {
      return `${where}: sso provider ${quote(fact.slug)} has no connection file with that slug under .zitadel/idps/.${didYouMean(fact.slug, fact.known)} Add the file, or remove the provider from the flow.`;
    },
  }),

  defineRule({
    id: "sso/flow-enables-sso",
    severity: "error",
    each: (config) => {
      return config.flows.all.flatMap((flow) => {
        const schema = config.flows.findSchemaOf(flow);
        if (schema === undefined) {
          return [];
        }
        return flow.steps.map((step) => {
          return { flow, step, schema };
        });
      });
    },
    when: (fact) => {
      return fact.step.providers.length > 0 && !fact.schema.isSsoEnabled;
    },
    file: (fact) => {
      return fact.flow.path;
    },
    steps: {
      step: (fact) => {
        return fact.step.name;
      },
      cause: () => {
        return "";
      },
    },
    says: (fact, where) => {
      return `${where}: offers sso_providers but "sso" is not an enabled authentication method in ${fact.schema.path}. Enable it there, or remove sso_providers.`;
    },
  }),

  defineRule({
    id: "sso/provider-id",
    severity: "error",
    // The providers the schema lists without a connection file, as the
    // connections they most likely meant.
    each: (config) => {
      const known = knownSlugs(config);
      return config.flows.pinnedOffers.map((offer) => {
        const meant = offer.schema.providers
          .filter((slug) => {
            return config.connections.find(slug) === undefined;
          })
          .map((slug) => {
            return closest(slug, known);
          });
        return { ...offer, meant };
      });
    },
    // A slug the schema lists without a connection file is most likely a typo
    // of a provider the flow offers: that is reported on the schema, so the
    // provider it was meant to be is not reported again here.
    when: (fact) => {
      return (
        fact.schema.isSsoEnabled &&
        fact.connection !== undefined &&
        !fact.schema.lists(fact.slug) &&
        !fact.meant.includes(fact.slug)
      );
    },
    file: (fact) => {
      return fact.flow.path;
    },
    steps: {
      step: (fact) => {
        return fact.step.name;
      },
      cause: (fact) => {
        return fact.slug;
      },
    },
    says: (fact, where) => {
      return `${where}: sso provider ${quote(fact.slug)} is not listed in sso.providers of ${fact.schema.path}. Add it there, or remove it from the flow.`;
    },
  }),

  defineRule({
    id: "sso/outcome-routing",
    severity: "error",
    each: (config) => {
      return config.flows.all.flatMap((flow) => {
        return flow.steps.map((step) => {
          return { flow, step, missing: unroutedOutcomes(config, step) };
        });
      });
    },
    when: (fact) => {
      return fact.step.providers.length > 0 && fact.missing.length > 0;
    },
    file: (fact) => {
      return fact.flow.path;
    },
    steps: {
      step: (fact) => {
        return fact.step.name;
      },
      cause: (fact) => {
        return fact.missing.join();
      },
    },
    says: (fact, where) => {
      const advice =
        fact.step.collisionCarriesAction && fact.missing.includes("user_already_exists")
          ? "A collision is followed only through a user_already_exists transition with no action, so remove its action. Add a transition for the rest."
          : "Add a transition for each.";
      return `${where}: offers sso_providers but does not route ${fact.missing.join(", ")}. ${advice}`;
    },
  }),

  defineRule({
    id: "sso/collection-conflict-routing",
    severity: "error",
    each: (config) => {
      return config.flows.all.flatMap((flow) => {
        return flow.steps.map((step) => {
          return { flow, step };
        });
      });
    },
    when: (fact) => {
      return fact.step.createsUserFromSso && !fact.step.routes.has("user_already_exists");
    },
    file: (fact) => {
      return fact.flow.path;
    },
    steps: {
      step: (fact) => {
        return fact.step.name;
      },
      cause: (fact) => {
        return String(fact.step.collisionCarriesAction);
      },
    },
    says: (fact, where) => {
      if (fact.step.collisionCarriesAction) {
        return `${where}: on_success create_user_with_sso must route user_already_exists, and an SSO collision is followed only through a transition with no action. Remove the action from it.`;
      }
      return `${where}: on_success create_user_with_sso must route user_already_exists. Add that transition.`;
    },
  }),

  defineRule({
    id: "sso/empty-claim-mapping",
    severity: "error",
    each: (config) => {
      return config.flows.pinnedOffers.flatMap((offer) => {
        const connection = offer.connection;
        // A provider that only signs people in fills no user, so what it maps
        // does not matter.
        if (connection === undefined || !connection.createsUsers) {
          return [];
        }
        return [{ ...offer, connection, listing: config.schemas.listOffering(offer.slug) }];
      });
    },
    // When no schema that lists the connection defines any mapped name, each
    // name is already reported as unknown, and fixing those fixes this too.
    when: (fact) => {
      const mapped = fact.connection.mappings;
      const allUnknown =
        mapped.length > 0 &&
        fact.listing.length > 0 &&
        mapped.every((row) => {
          return !fact.listing.some((schema) => {
            return schema.has(row.property);
          });
        });
      const fillsSomething = mapped.some((row) => {
        return fact.schema.has(row.property);
      });
      return !allUnknown && !fillsSomething;
    },
    file: (fact) => {
      return fact.flow.path;
    },
    steps: {
      step: (fact) => {
        return fact.step.name;
      },
      cause: (fact) => {
        return fact.slug;
      },
    },
    says: (fact, where) => {
      const what =
        fact.connection.mappings.length === 0
          ? "is empty"
          : `maps nothing ${fact.schema.path} defines`;
      return `${where}: claim_mapping of ${quote(fact.slug)} (${fact.connection.path}) ${what}, so no sign-in can fill the user. Map at least one property of ${fact.schema.path} in ${fact.connection.path}.`;
    },
  }),

  defineRule({
    id: "sso/collection-misses-required",
    severity: "error",
    each: (config) => {
      return config.flows.signUpGaps;
    },
    file: (gap) => {
      return gap.flow.path;
    },
    steps: {
      step: (gap) => {
        return gap.step.name;
      },
      cause: (gap) => {
        return JSON.stringify([gap.connection.path, gap.path]);
      },
    },
    says: (gap, where) => {
      const slug = gap.connection.slug ?? gap.connection.path;
      return `${where}: on_success create_user_with_sso can create a user without ${quote(gap.path)}, which ${gap.schema.path} requires (or signs people in by): someone signing up with ${quote(slug)} gets here without being asked for it, and ${gap.connection.path} does not map it. Ask for it on a step on the way, or map it in ${gap.connection.path}.`;
    },
  }),

  defineRule({
    id: "sso/unmapped-verification-key",
    severity: "error",
    each: (config) => {
      return standing(config).flatMap((entry) => {
        // A connection no schema lists and no flow offers is not in use, such
        // as the file `auth-method sso disable` keeps, so it is not judged.
        const offered = config.flows.offers.some((offer) => {
          return offer.slug === entry.slug;
        });
        if (entry.listing.length === 0 && !offered) {
          return [];
        }
        // A mapped name no schema defines that is a typo of a verified key is
        // reported with a "Did you mean" naming that key; the key then has no
        // mapping only because of that typo, so it is not reported again.
        const meant = entry.connection.mappings
          .filter((row) => {
            return unreadable(entry, row.property);
          })
          .map((row) => {
            return closest(row.property, readableProperties(entry));
          });
        return entry.connection.verifications.map((row) => {
          return { entry, property: row.property, meant };
        });
      });
    },
    when: (fact) => {
      return (
        !fact.entry.connection.maps(fact.property) &&
        !unreadable(fact.entry, fact.property) &&
        !fact.meant.includes(fact.property)
      );
    },
    file: (fact) => {
      return fact.entry.connection.path;
    },
    says: (fact) => {
      return `verified_claims key ${quote(fact.property)} has no claim_mapping entry, so the claim is never read. Add ${quote(fact.property)} to claim_mapping, or remove it from verified_claims.`;
    },
  }),

  defineRule({
    id: "sso/claim-needs-scope",
    severity: "warning",
    // A scope the standard does not define may bundle claims, so only a list
    // of standard scopes alone can be said to leave a claim out. Only a
    // warning: a provider may return the claim another way.
    each: (config) => {
      return standing(config).flatMap((entry) => {
        const scopes = entry.connection.scopes;
        if (scopes === undefined || !scopes.every(isStandardScope)) {
          return [];
        }
        const missing = claimReads(entry.connection).flatMap((read) => {
          const scope = standardClaim(read.claim)?.scope;
          if (scope === undefined || scopes.includes(scope)) {
            return [];
          }
          return [{ ...read, scope }];
        });
        const groups = [
          ...new Set(
            missing.map((read) => {
              return JSON.stringify([read.field, read.scope]);
            }),
          ),
        ];
        return groups.flatMap((key) => {
          const members = missing.filter((read) => {
            return JSON.stringify([read.field, read.scope]) === key;
          });
          const first = members[0];
          if (first === undefined) {
            return [];
          }
          const claims = [
            ...new Set(
              members.map((read) => {
                return read.claim;
              }),
            ),
          ];
          return [
            {
              connection: entry.connection,
              scopes,
              field: first.field,
              scope: first.scope,
              claims,
            },
          ];
        });
      });
    },
    file: (fact) => {
      return fact.connection.path;
    },
    says: (fact) => {
      return `${fact.field} reads ${fact.claims.map(quote).join(", ")}, which a provider only returns for the ${quote(fact.scope)} scope, and oidc.scopes is ${fact.scopes.map(quote).join(", ")}. Add ${quote(fact.scope)} to oidc.scopes, or read another claim.`;
    },
  }),

  defineRule({
    id: "sso/verification-source-not-boolean",
    severity: "warning",
    each: (config) => {
      return standing(config).flatMap((entry) => {
        return entry.connection.verifications.flatMap((row) => {
          const standard = standardClaim(row.claim);
          if (standard === undefined || typeof row.claim !== "string") {
            return [];
          }
          return [
            {
              connection: entry.connection,
              property: row.property,
              claim: row.claim,
              type: standard.type,
            },
          ];
        });
      });
    },
    when: (fact) => {
      return fact.type !== "boolean";
    },
    file: (fact) => {
      return fact.connection.path;
    },
    says: (fact) => {
      return `verified_claims reads ${quote(fact.claim)} to verify ${quote(fact.property)}, but that is ${article(fact.type)} ${fact.type} claim, not one that says whether a value is verified, so it never verifies. Read the claim the provider sends for that (such as "email_verified").`;
    },
  }),

  defineRule({
    id: "sso/claim-name-whitespace",
    severity: "error",
    // A claim name is matched exactly, so a space around it names a claim no
    // provider sends.
    each: (config) => {
      return standing(config).flatMap((entry) => {
        const subject = entry.connection.subjectClaim;
        const subjectReads: readonly ClaimRead[] =
          subject === undefined ? [] : [{ field: "subject_claim", claim: subject }];
        return [...claimReads(entry.connection), ...subjectReads].map((read) => {
          return { connection: entry.connection, ...read };
        });
      });
    },
    when: (fact) => {
      return EDGE_SPACE.test(fact.claim);
    },
    file: (fact) => {
      return fact.connection.path;
    },
    says: (fact) => {
      return `${fact.field} names ${quote(fact.claim)}, which has a space at its start or end, so no provider sends a claim by that name. Remove the space.`;
    },
  }),

  defineRule({
    id: "sso/subject-claim-unstable",
    severity: "warning",
    // Identity keys on the subject, so it has to be a value that never
    // changes. Only before the first deploy: the server keeps a connection's
    // subject once it has it, so the advice could not be followed after.
    each: (config) => {
      return standing(config).flatMap((entry) => {
        const subject = entry.connection.subjectClaim;
        if (subject === undefined || config.connections.isDeployed(entry.slug)) {
          return [];
        }
        return [{ connection: entry.connection, subject }];
      });
    },
    when: (fact) => {
      return standardClaim(fact.subject) !== undefined || MUTABLE_SUBJECTS.has(fact.subject);
    },
    file: (fact) => {
      return fact.connection.path;
    },
    says: (fact) => {
      return `subject_claim is ${quote(fact.subject)}, a profile claim the user can change, and identity keys on the subject, so a change would sign them in as a stranger. Use a claim that never changes: "sub", or a provider-specific one such as "oid".`;
    },
  }),

  defineRule({
    id: "sso/claim-type-mismatch",
    severity: "warning",
    each: (config) => {
      return standing(config).flatMap((entry) => {
        return entry.connection.mappings.flatMap((row) => {
          const standard = standardClaim(row.claim);
          if (standard === undefined || typeof row.claim !== "string") {
            return [];
          }
          const declared = entry.listing.flatMap((schema) => {
            const types = schema.findDeclaredTypes(row.property);
            if (types === undefined) {
              return [];
            }
            return [types];
          });
          return [
            {
              connection: entry.connection,
              property: row.property,
              claim: row.claim,
              standard,
              declared,
            },
          ];
        });
      });
    },
    when: (fact) => {
      return (
        fact.declared.length > 0 &&
        !fact.declared.some((types) => {
          return types.some((type) => {
            return fits(fact.standard.type, type);
          });
        })
      );
    },
    file: (fact) => {
      return fact.connection.path;
    },
    says: (fact) => {
      const declared = [...new Set(fact.declared.flat())];
      return `claim_mapping reads ${quote(fact.claim)}, ${article(fact.standard.type)} ${fact.standard.type} claim, into ${quote(fact.property)}, which the schema types as ${declared.join(" or ")}. Read a claim of a matching type, or change the type of ${quote(fact.property)}.`;
    },
  }),

  defineRule({
    id: "sso/orphaned-mapping-target",
    severity: "error",
    each: (config) => {
      return standing(config).flatMap((entry) => {
        return entry.connection.mappings.map((row) => {
          return { entry, property: row.property };
        });
      });
    },
    when: (fact) => {
      return unreadable(fact.entry, fact.property);
    },
    file: (fact) => {
      return fact.entry.connection.path;
    },
    says: (fact) => {
      // What a mistyped name could have meant: the properties of the schemas
      // that list this connection, less the ones already mapped.
      const nameable = readableProperties(fact.entry).filter((name) => {
        return !fact.entry.connection.maps(name);
      });
      return `claim_mapping target ${quote(fact.property)} is not a property of any schema that lists ${quote(fact.entry.slug)} in sso.providers.${didYouMean(fact.property, nameable)} Fix the name, or remove the row.`;
    },
  }),

  defineRule({
    id: "sso/orphaned-verification-key",
    severity: "error",
    each: (config) => {
      return standing(config).flatMap((entry) => {
        return entry.connection.verifications.map((row) => {
          return { entry, property: row.property };
        });
      });
    },
    when: (fact) => {
      return unreadable(fact.entry, fact.property);
    },
    file: (fact) => {
      return fact.entry.connection.path;
    },
    says: (fact) => {
      return `verified_claims key ${quote(fact.property)} is not a property of any schema that lists ${quote(fact.entry.slug)} in sso.providers, so it can never verify.${didYouMean(fact.property, readableProperties(fact.entry))} Fix the name, or remove it.`;
    },
  }),
];
