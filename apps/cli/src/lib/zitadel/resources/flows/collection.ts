import type { ConnectionSlug } from "@zitadel/config/idp";

import { NotFoundError } from "@/lib/zitadel/errors";
import { type PropertyPath, propertyName, propertyPath, type StepName } from "@/lib/zitadel/names";
import { PinnedCollection } from "@/lib/zitadel/resources/collection";
import { Flow } from "@/lib/zitadel/resources/flows/flow";
import type { Step } from "@/lib/zitadel/resources/flows/step";
import type { Offer, PinnedOffer, SignUpGap, Visit } from "@/lib/zitadel/resources/flows/types";
import type { UserSchema } from "@/lib/zitadel/resources/schemas/schema";
import { assertFlowsIntact } from "@/lib/zitadel/rules/flows";
import { CONFIG_DIRECTORIES } from "@/lib/zitadel/types";
import { walk } from "@/lib/zitadel/utils/graph";

/**
 * The login flows under `.zitadel/flows/`, the user schema each runs against,
 * and the providers their steps offer.
 */
export class Flows extends PinnedCollection<Flow> {
  /**
   * The kind of file the collection owns.
   */
  readonly kinds = ["flow"] as const;

  /**
   * Where a flow goes when no file holds its name.
   */
  protected readonly directory = CONFIG_DIRECTORIES.flows;

  /**
   * Every provider a flow step offers, once for each time a step lists it.
   *
   * @returns The offers, flow by flow and step by step.
   */
  get offers(): readonly Offer[] {
    return this.all.flatMap((flow) => {
      return flow.steps.flatMap((step) => {
        return step.providers.map((slug): Offer => {
          return { flow, step, slug, connection: this.config.connections.find(slug) };
        });
      });
    });
  }

  /**
   * The offers on flows whose schema is a local file, each with that schema.
   *
   * @returns The offers, flow by flow and step by step.
   */
  get pinnedOffers(): readonly PinnedOffer[] {
    return this.offers.flatMap((offer): readonly PinnedOffer[] => {
      const schema = this.findSchemaOf(offer.flow);
      if (schema === undefined) {
        return [];
      }
      return [{ ...offer, schema }];
    });
  }

  /**
   * Every way someone signing up with a provider reaches a step that creates
   * their user without having been asked for a required property the
   * provider does not map.
   *
   * @remarks
   * Walks each flow from its entry steps, one required property at a time. A
   * step that asks for the property ends that path; a provider outcome
   * carries the provider that was chosen on to the next step. The engine
   * keeps every answer given on the way, so a property asked for on an
   * earlier step counts.
   *
   * @returns The gaps.
   */
  get signUpGaps(): readonly SignUpGap[] {
    return this.all.flatMap((flow) => {
      const schema = this.findSchemaOf(flow);
      if (schema === undefined) {
        return [];
      }
      return schema.requiredPaths.flatMap((path) => {
        return this.findGaps(flow, schema, propertyPath(path));
      });
    });
  }

  /**
   * Find the flows that run against a user schema: those whose `user_schema`
   * names it, as {@link findSchemaOf} resolves it.
   *
   * @param schema - The schema.
   * @returns Its flows.
   */
  findForSchema(schema: UserSchema): readonly Flow[] {
    return this.all.filter((flow) => {
      return this.findSchemaOf(flow)?.path === schema.path;
    });
  }

  /**
   * Find the local schema a flow's `user_schema` names.
   *
   * @remarks
   * A flow names its schema by the schema's `objectType`, which the platform
   * resolves it by, or its `$id`. Once a project has been deployed, a flow may
   * name it by an id the platform assigned, which the caller passes in as
   * `published`. A schema with no `$id` is also named by the URL setup wrote,
   * whose last segment is the file name; a schema with an `$id` is not, since
   * its `$id` says what flows name it by, and guessing past it is how the
   * wrong flow would be edited. Each way is tried across every schema before
   * the next, so a weaker match never wins over a stronger one.
   *
   * @param flow - The flow.
   * @returns The schema, or `undefined` when no local schema is named.
   */
  findSchemaOf(flow: Flow): UserSchema | undefined {
    const reference = flow.userSchema;
    if (reference === undefined) {
      return undefined;
    }
    const schemas = this.config.schemas.all;
    const published = this.config.options.published;
    const byName = schemas.find((schema) => {
      return schema.isNamedBy(reference);
    });
    if (byName !== undefined) {
      return byName;
    }
    const byPublishedId = schemas.find((schema) => {
      return published?.get(schema.path)?.includes(reference) === true;
    });
    if (byPublishedId !== undefined) {
      return byPublishedId;
    }
    return schemas.find((schema) => {
      return typeof schema.body.$id !== "string" && reference.endsWith(`/${schema.name}.json`);
    });
  }

  /**
   * Resolve the login flows a provider is offered on when it is enabled for a
   * user schema, with the schema and each flow checked first for a region the
   * edit could not write, so a caller can refuse before it asks anything.
   *
   * @remarks
   * Once the provider's slug is known, and before anything else about its
   * connection is, the flows are also held to the server's rules as offering
   * it would leave them, so a flow `deploy` would reject is refused the moment
   * the slug is typed.
   *
   * @param schema - The schema.
   * @param slug - The provider, when it is known.
   * @returns The flows that run against it.
   * @throws {@link NotFoundError} When no flow runs against the schema: a
   *   provider no flow offers is no sign-in button at all.
   * @throws {@link RefusedEditError} When a region the edit writes is not the
   *   shape it writes.
   * @throws {@link BrokenFlowsError} When offering the slug would leave a flow
   *   failing the server's rules, or one already fails them.
   */
  resolveForSso(schema: UserSchema, slug?: ConnectionSlug): readonly Flow[] {
    const flows = this.findForSchema(schema);
    if (flows.length === 0) {
      throw new NotFoundError(`No login flow runs against ${schema.name}`, {
        hint:
          "The provider is offered by a flow, and none of the files under .zitadel/flows/ " +
          "names this schema. Check that the flow's user_schema names the schema's objectType.",
        details: { schema: schema.path },
      });
    }
    for (const flow of flows) {
      flow.assertProviderEditable();
    }
    if (slug === undefined) {
      return flows;
    }
    const edited = schema.withProvider(slug).document;
    const after = flows.reduce((current, flow) => {
      return current.with(flow.withProvider(slug, schema.enabledMethods).document);
    }, this.config.with(edited));
    assertFlowsIntact({ before: this.config, after, original: schema, edited });
    return flows;
  }

  /**
   * Find the sign-up gaps for one required property of one flow.
   *
   * @remarks
   * A breadth-first walk from the entry steps, which visits each step once
   * for each provider that can be chosen on the way to it, and stops at a
   * step that asks for the property.
   *
   * @param flow - The flow.
   * @param schema - The schema it runs against.
   * @param path - The required property's dotted path.
   * @returns The gaps.
   */
  private findGaps(flow: Flow, schema: UserSchema, path: PropertyPath): readonly SignUpGap[] {
    const unasked = (name: StepName | undefined): Step | undefined => {
      if (name === undefined) {
        return undefined;
      }
      const step = flow.findStep(name);
      if (step === undefined || step.asksFor(path)) {
        return undefined;
      }
      return step;
    };
    const start = flow.entrySteps.flatMap((name): readonly Visit[] => {
      const step = unasked(name);
      if (step === undefined) {
        return [];
      }
      return [{ step, provider: undefined }];
    });
    const visits = walk(
      start,
      (from) => {
        return from.step.transitions.flatMap((transition): readonly Visit[] => {
          // A cross-flow transition's target is followed too, as a step of
          // this flow by that name.
          if (transition.kind !== "step" && transition.kind !== "cross-flow") {
            return [];
          }
          const next = unasked(transition.target);
          if (next === undefined) {
            return [];
          }
          if (Flow.isProviderOutcome(transition.outcome)) {
            return from.step.providers.map((provider) => {
              return { step: next, provider };
            });
          }
          return [{ step: next, provider: from.provider }];
        });
      },
      (visit) => {
        return JSON.stringify([visit.step.name, visit.provider ?? ""]);
      },
    );
    const top = propertyName(path.split(".")[0] ?? path);
    return visits.flatMap((visit): readonly SignUpGap[] => {
      if (visit.provider === undefined || !visit.step.createsUserFromSso) {
        return [];
      }
      const connection = this.config.connections.find(visit.provider);
      if (connection === undefined || !connection.createsUsers || connection.maps(top)) {
        return [];
      }
      return [{ flow, schema, step: visit.step, connection, path }];
    });
  }
}
