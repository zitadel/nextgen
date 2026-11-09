import type { Credential, QueriedUser, UserQuery } from "@/lib/backend";
import { isCancellation } from "@/lib/errors";
import { isObject } from "@/lib/json";
import { mapBounded } from "@/lib/map-bounded";
import { reportWarning } from "@/lib/warnings";
import type { Step, StepContext } from "@/lib/publish/pipeline";
import { BrokenFile, isJsonObject, isJsonValue, type JsonObject, UserSchema } from "@/lib/zitadel";

/**
 * Users read per page.
 */
const PAGE_SIZE = 100;

/**
 * The most users the whole check reads, shared out across its scans.
 */
const SCAN_CAP = 1000;

/**
 * The most stranded users whose identity links are looked up.
 */
const LINK_CHECKS = 200;

/**
 * Identity-link reads in flight at once.
 */
const CONCURRENCY = 10;

/**
 * The ways in a user can hold a credential for, in the order a schema lists them.
 */
const CREDENTIALS: readonly Credential[] = ["password", "passkey", "sso"];

/**
 * One filter of a user query.
 */
type UserFilter = NonNullable<UserQuery["filter"]>[number];

/**
 * A flow the engine can select: the object type of its schema, and the
 * identifier its login path looks users up by, when it collects one.
 */
type Served = {
  /**
   * The object type of the flow's schema.
   */
  readonly schema: string;

  /**
   * The property the login path looks users up by; `undefined` when it collects none.
   */
  readonly identifier: string | undefined;
};

/**
 * What a scan found, whose users it only partly read without finding anything,
 * and whether a request failed.
 */
type Scan = {
  readonly warnings: readonly string[];
  readonly partial: readonly string[];
  readonly failed: boolean;
};

/**
 * A schema as the project lists it: its object type, designated identifier and
 * the ways in it enables.
 */
type SchemaInfo = {
  readonly objectType: string;
  readonly identifier: string | undefined;
  readonly methods: readonly Credential[];
};

/**
 * A schema whose users this release takes a way to sign in from, and the ways it keeps.
 */
type MethodChange = {
  readonly objectType: string;
  readonly disabled: readonly Credential[];
  readonly kept: readonly Credential[];
};

/**
 * The project's schemas by revision id and by object type.
 */
type Listing = {
  readonly byId: ReadonlyMap<string, SchemaInfo>;

  /**
   * The newest revision of each object type, which is what a flow naming the
   * object type runs on.
   */
  readonly byObjectType: ReadonlyMap<string, SchemaInfo>;
};

/**
 * The project's listing, read on first use, or nothing when it could not be read.
 */
type Names = () => Promise<Listing | undefined>;

/**
 * What a flow came to when its schema was looked up.
 */
type FlowLookup =
  | { readonly kind: "served"; readonly flow: Served }
  | { readonly kind: "ignored" }
  | { readonly kind: "unresolved" }
  | { readonly kind: "unreadable" };

/**
 * The flows the engine can select, and why the unserved check cannot run, if
 * it cannot.
 */
type ServedFlows = {
  readonly flows: readonly Served[];

  /**
   * Whether a flow names a schema neither the release nor the project holds.
   */
  readonly unresolved: boolean;

  /**
   * Whether the listing that would say so could not be read.
   */
  readonly unreadable: boolean;
};

/**
 * What the live release's schemas say about the methods this release disables.
 */
type DisabledMethods = {
  readonly changes: readonly MethodChange[];
  readonly unreadable: boolean;
};

/**
 * A release live on a primary origin: whether it pins a flow, and the schema
 * revisions it pins.
 */
type LiveRelease = {
  readonly pinsFlow: boolean;
  readonly schemas: readonly string[];
};

/**
 * Some of the users a query matches, and whether there were more.
 */
type ReadUsers = {
  readonly users: readonly QueriedUser[];
  readonly truncated: boolean;
};

/**
 * Users stranded on one schema, and how many of them have a provider linked.
 */
type Stranded = {
  readonly name: string | typeof UNNAMED;
  readonly users: number;
  readonly linked: number;
};

/**
 * A scan with nothing to report.
 */
const NOTHING: Scan = { warnings: [], partial: [], failed: false };

/**
 * What stranded users are counted under when their schema could not be named.
 */
const UNNAMED = Symbol("unnamed");

/**
 * Only active users can sign in, so only they can be locked out.
 */
const ACTIVE: UserFilter = { field: "status", operation: "equals", value: "active" };

/**
 * Warn when this deploy leaves users who exist today unable to sign in. A
 * deploy that passes validation can still lock people out, because the flow
 * and the schema are judged without the users they will meet:
 *
 * - a schema whose designated identifier (`x-identifier`) is a property the
 *   existing users of that schema do not carry sends them to registration when
 *   they type their old identifier, once a step on the login path collects it;
 * - users of a schema that no flow in the release serves cannot sign in at all
 *   (a flow moved to another schema leaves them there), and those with a
 *   linked provider account cannot continue an SSO sign-in either;
 * - users whose only credential is a method this release disables on their
 *   schema (a passkey, once passkeys are off) have nothing left to sign in with.
 *
 * All are read from the users the project holds now, so they hold whatever
 * the previous release said. Warn only: a deploy that does this on purpose, or
 * after migrating the users, is not stopped. The check is best effort, as it
 * only needs read access and a failing read must never fail a deploy.
 */
export const lockoutStep: Step = {
  name: "lockout",
  runsFor: ["deploy"],
  async run(ctx: StepContext): Promise<undefined> {
    // Branding, policies and connections cannot lock anyone out. Without a
    // diff to say so, the check runs.
    // A flow whose schema the release does not carry runs on the server's
    // newest revision, which a clean diff says nothing about.
    if (
      ctx.learned?.schemasOrFlowsChanged === false &&
      !ctx.config.flows.all.some((flow) => {
        return flow.userSchema !== undefined && ctx.config.flows.findSchemaOf(flow) === undefined;
      })
    ) {
      return undefined;
    }
    try {
      for (const message of await lockoutWarnings(ctx)) {
        reportWarning(message);
      }
    } catch (error) {
      // The person stopping the command is not a check that could not finish.
      if (isCancellation(error)) {
        throw error;
      }
      // Never a failed deploy, but never a silent pass either.
      reportWarning(
        "Could not finish checking existing users for sign-in lockouts: an unexpected error stopped the check.",
      );
    }
    return undefined;
  },
};

/**
 * Several scans as one.
 *
 * @param scans - The scans.
 * @returns Every warning and partial schema, and whether any request failed.
 */
function merged(scans: readonly Scan[]): Scan {
  return {
    warnings: scans.flatMap((scan) => {
      return scan.warnings;
    }),
    partial: scans.flatMap((scan) => {
      return scan.partial;
    }),
    failed: scans.some((scan) => {
      return scan.failed;
    }),
  };
}

/**
 * The project's listing, read once on first use.
 *
 * @remarks
 * Names are only needed for flows that name a schema by id and for the SSO
 * warning, so they are read on first use, and a failed read costs the names.
 * The read is remembered so every scan shares one request.
 *
 * @param ctx - The step's context.
 * @returns The listing, read on first use.
 */
function lazyNames(ctx: StepContext): Names {
  // The one piece of state the check keeps: the read, once it is started.
  let listed: Promise<Listing | undefined> | undefined;
  return () => {
    listed ??= objectTypes(ctx).catch(() => {
      return undefined;
    });
    return listed;
  };
}

/**
 * Why the unserved-schema check cannot run, if it cannot.
 *
 * @remarks
 * A release with no flow definitions runs it like any other: the server serves
 * only what a release pins, so such a release serves no sign-in and strands
 * every user.
 *
 * @param served - The flows served, and what kept a flow's schema unknown.
 * @returns The note saying why it was skipped, or `undefined` when it runs.
 */
function unservedSkipped(served: ServedFlows): string | undefined {
  if (served.unreadable) {
    return "Skipped the check for users of schemas no flow serves: the project's schemas could not be read.";
  }
  if (served.unresolved) {
    return "Skipped the check for users of schemas no flow serves: a flow names a schema that this release does not define.";
  }
  return undefined;
}

/**
 * Every lockout warning, then the notes that say what the check could not do.
 *
 * @param ctx - The step's context.
 * @returns The warnings, then the notes.
 */
async function lockoutWarnings(ctx: StepContext): Promise<readonly string[]> {
  const names = lazyNames(ctx);
  const served = await servedFlows(ctx, names);
  const flows = served.flows;
  const ssoSkipped = unservedSkipped(served);
  const disabling = await disabledMethods(ctx, names, flows);
  // Every scan gets its own share of the cap up front, so none can starve
  // another and the total stays within it.
  const scanned = new Set(
    flows
      .filter((flow) => {
        return flow.identifier !== undefined;
      })
      .map((flow) => {
        return flow.schema;
      }),
  );
  const share = Math.max(1, Math.floor(SCAN_CAP / (scanned.size + 1 + disabling.changes.length)));
  // One scan failing must not discard what the other found.
  const settled = await Promise.allSettled([
    lookupWarnings(ctx, flows, share),
    ssoSkipped === undefined ? unservedWarnings(ctx, flows, names, share) : NOTHING,
    credentialWarnings(ctx, disabling.changes, share),
  ]);
  const scans = settled.flatMap((outcome) => {
    if (outcome.status !== "fulfilled") {
      return [];
    }
    return [outcome.value];
  });
  const scan = merged(scans);
  // A clean result must not look the same as a check that did not run fully.
  const rejected = settled.some((outcome) => {
    return outcome.status === "rejected";
  });
  const failedNote =
    rejected || scan.failed
      ? [
          "Could not finish checking existing users for sign-in lockouts: a request to the server failed.",
        ]
      : [];
  const skippedNote = ssoSkipped === undefined ? [] : [ssoSkipped];
  const disablingNote = disabling.unreadable
    ? [
        "Skipped the check for users whose only way to sign in this release disables: the live release's schemas could not be read.",
      ]
    : [];
  const partialNote =
    scan.partial.length > 0
      ? [
          `Checked only some of the users of ${scan.partial.join(", ")} for sign-in lockouts (the read limit was reached), so a clean result is not proof.`,
        ]
      : [];
  return [...scan.warnings, ...failedNote, ...skippedNote, ...disablingNote, ...partialNote];
}

/**
 * The flows the engine can select, each against the object type of its schema.
 *
 * @remarks
 * A flow's `user_schema` is an object type, or a schema id or `$id` URL that
 * the server resolves to one; a draft flow is never selected. A schema the
 * release carries is resolved the way the configuration resolves it, and any
 * other through the project's listing.
 *
 * Only the schema's designated identifier performs a lookup, and only when a
 * step on the login path ({@link Flow.loginFields}) collects it. The release
 * pins the newest revision, so a revision id only names the object type: the
 * release's own schema decides the identifier (and may have none), and the
 * newest listed revision decides it only for a schema the release does not
 * carry.
 *
 * @param ctx - The step's context.
 * @param names - The project's schemas, read on first use.
 * @returns The flows served, whether a flow names a schema neither the release
 *   nor the project holds, and whether the listing that would say so could not
 *   be read.
 */
async function servedFlows(ctx: StepContext, names: Names): Promise<ServedFlows> {
  // One flow at a time: the first to need the listing reads it for the rest.
  const lookups = await mapBounded(ctx.config.flows.all, 1, async (flow): Promise<FlowLookup> => {
    const reference = flow.userSchema;
    if (reference === undefined || flow.body.status === "draft") {
      return { kind: "ignored" };
    }
    const carried = ctx.config.flows.findSchemaOf(flow)?.objectType;
    const listing = carried === undefined ? await names() : undefined;
    const listed = listing?.byId.get(reference) ?? listing?.byObjectType.get(reference);
    const schema = carried ?? listed?.objectType;
    if (schema === undefined) {
      // Without the listing it is not known whether the schema exists.
      if (listing === undefined) {
        return { kind: "unreadable" };
      }
      return { kind: "unresolved" };
    }
    const bundled = ctx.config.schemas.all.find((candidate) => {
      return candidate.objectType === schema;
    });
    const identifier =
      bundled === undefined ? listing?.byObjectType.get(schema)?.identifier : bundled.identifier;
    const looksUp = identifier !== undefined && flow.loginFields.has(identifier);
    return {
      kind: "served",
      flow: { schema, identifier: looksUp ? identifier : undefined },
    };
  });
  return {
    flows: lookups.flatMap((lookup) => {
      if (lookup.kind !== "served") {
        return [];
      }
      return [lookup.flow];
    }),
    unresolved: lookups.some((lookup) => {
      return lookup.kind === "unresolved";
    }),
    unreadable: lookups.some((lookup) => {
      return lookup.kind === "unreadable";
    }),
  };
}

/**
 * A field the login flow looks users up by that the users of its schema lack.
 *
 * @param ctx - The step's context.
 * @param flows - The flows served.
 * @param share - The most users this scan reads per schema.
 * @returns What the scan found.
 */
async function lookupWarnings(
  ctx: StepContext,
  flows: readonly Served[],
  share: number,
): Promise<Scan> {
  // The designated identifier belongs to the schema, so there is one per schema.
  const lookups = [
    ...new Map(
      flows.flatMap((flow): readonly (readonly [string, string])[] => {
        if (flow.identifier === undefined) {
          return [];
        }
        return [[flow.schema, flow.identifier]];
      }),
    ),
  ];
  const scans = await mapBounded(lookups, CONCURRENCY, async (lookup): Promise<Scan> => {
    const objectType = lookup[0];
    const identifier = lookup[1];
    try {
      const read = await readUsers(
        ctx,
        [{ field: "schema_object_type", operation: "equals", value: objectType }, ACTIVE],
        share,
      );
      const missing = read.users.filter((user) => {
        return !carries(user, identifier);
      });
      if (missing.length === 0) {
        const partial = read.truncated ? [quote(objectType)] : [];
        return { warnings: [], partial, failed: false };
      }
      const missingCount = count(missing.length, read.truncated);
      const userCount = count(read.users.length, read.truncated);
      const users = plural(read.users.length, "user");
      const verb = missing.length === 1 ? "has" : "have";
      const fix = ctx.suggest(
        `users update <user_id> --schema <revision_id> --set attributes.${identifier}=<value>`,
      );
      return {
        warnings: [
          `${missingCount} of ${userCount} existing ${users} of ${quote(objectType)} ${verb} no ${quote(identifier)}, the field the login flow looks users up by, so those who sign in with a password and type it are offered registration instead of being signed in. Move each user to the schema revision that defines it and set it in one update: ${fix}`,
        ],
        partial: [],
        failed: false,
      };
    } catch {
      // One schema's failed read must not discard the warnings of the others.
      return { warnings: [], partial: [], failed: true };
    }
  });
  return merged(scans);
}

/**
 * Users on a schema no flow serves any more, and which of them have a provider linked.
 *
 * @param ctx - The step's context.
 * @param flows - The flows served.
 * @param names - The project's schemas, read on first use.
 * @param share - The most users this scan reads.
 * @returns What the scan found.
 * @throws When the users cannot be read.
 */
async function unservedWarnings(
  ctx: StepContext,
  flows: readonly Served[],
  names: Names,
  share: number,
): Promise<Scan> {
  const served = [
    ...new Set(
      flows.map((flow) => {
        return flow.schema;
      }),
    ),
  ];
  const notServed = served.map((value): UserFilter => {
    return { field: "schema_object_type", operation: "not_equals", value };
  });
  const read = await readUsers(ctx, [...notServed, ACTIVE], share);
  // Every one of them is stranded, linked or not. The link read is one request
  // per user, so only the first few are asked, and the SSO count says so.
  const stranded = read.users;
  const linkChecked = stranded.slice(0, LINK_CHECKS);
  const linksPartial = stranded.length > LINK_CHECKS || read.truncated;
  // Its own boundary: a link read that fails (a user deleted since the query)
  // must not discard the other warnings, so it is `undefined` and only makes
  // the count a lower bound.
  const hasLink = await mapBounded(linkChecked, CONCURRENCY, async (user) => {
    try {
      // A user deleted since the query holds no links, which the service
      // answers rather than raising: nothing to report for them.
      return await ctx.users.hasIdentityLink(user.id);
    } catch (error) {
      if (isCancellation(error)) {
        throw error;
      }
      return undefined;
    }
  });
  const failed = hasLink.includes(undefined);
  const linksUnsure = linksPartial || failed;
  const listing = stranded.length > 0 ? await names() : undefined;
  // Revisions of one schema share an object type, so they are one count.
  const schemaOf = stranded.map((user) => {
    return listing?.byId.get(user.schema)?.objectType ?? UNNAMED;
  });
  const counted = [...new Set(schemaOf)].map((name): Stranded => {
    const indexes = schemaOf.flatMap((schema, index) => {
      if (schema !== name) {
        return [];
      }
      return [index];
    });
    const linked = indexes.filter((index) => {
      return hasLink[index] === true;
    });
    return { name, users: indexes.length, linked: linked.length };
  });
  const warnings = counted.map((entry) => {
    return strandedWarning(entry, read.truncated, linksUnsure);
  });
  const partial = read.truncated && warnings.length === 0 ? ["the schemas no flow serves"] : [];
  return { warnings, partial, failed };
}

/**
 * The warning for the users stranded on one schema.
 *
 * @param entry - The schema, how many users it strands and how many are linked.
 * @param truncated - Whether the users were only partly read.
 * @param linksUnsure - Whether the links were only partly read.
 * @returns The warning.
 */
function strandedWarning(entry: Stranded, truncated: boolean, linksUnsure: boolean): string {
  const label =
    typeof entry.name === "string" ? quote(entry.name) : "schemas whose names could not be read";
  const users = `${count(entry.users, truncated)} existing ${plural(entry.users, "user")}`;
  const verb = entry.users === 1 ? "is" : "are";
  const linkedVerb = entry.linked === 1 ? "has" : "have";
  const sso =
    entry.linked > 0
      ? ` (${count(entry.linked, linksUnsure)} of them ${linkedVerb} an SSO link)`
      : "";
  return `${users} of ${label} ${verb} on a schema no flow in this release uses${sso}, so they cannot sign in with a password or SSO. Users cannot move between schemas, so keep or restore a flow on ${label}.`;
}

/**
 * The schemas whose revision in the live release enables a way to sign in
 * that the revision this release pins does not.
 *
 * @remarks
 * Its own revision, or the newest one for a schema a flow names that the
 * release does not carry. The live release is the baseline, not the newest
 * revision listed: a schema switched off and back on again pins an older
 * revision. A schema nothing live pins has no users of the live login to
 * strand, and nothing deployed means nothing to compare.
 *
 * @param ctx - The step's context.
 * @param names - The project's schemas, read on first use.
 * @param flows - The flows served.
 * @returns Each schema's disabled and kept methods, and whether the live
 *   schemas could not be read.
 */
async function disabledMethods(
  ctx: StepContext,
  names: Names,
  flows: readonly Served[],
): Promise<DisabledMethods> {
  // What each schema enables after this release: the release's own revision,
  // or, for a schema a flow names that the release does not carry, the newest
  // revision, which the server pins in its place.
  const bundled = new Map(
    ctx.config.schemas.all.flatMap(
      (schema): readonly (readonly [string, readonly Credential[]])[] => {
        const objectType = schema.objectType;
        if (objectType === undefined) {
          return [];
        }
        return [[objectType, credentialMethods(schema)]];
      },
    ),
  );
  const named = new Set(
    flows.map((flow) => {
      return flow.schema;
    }),
  );
  const autoPinned = [...named].filter((objectType) => {
    return !bundled.has(objectType);
  });
  if (bundled.size === 0 && autoPinned.length === 0) {
    return { changes: [], unreadable: false };
  }
  const releases = await liveReleases(ctx);
  if (releases === undefined) {
    return { changes: [], unreadable: true };
  }
  if (releases.length === 0) {
    return { changes: [], unreadable: false };
  }
  const listing = await names();
  if (listing === undefined) {
    return { changes: [], unreadable: true };
  }
  // Every primary origin's release counts: a method any of them enables is in
  // use. A release that pins no flow serves no sign-in, so none of its methods
  // are in use.
  const liveIds = releases
    .filter((release) => {
      return release.pinsFlow;
    })
    .flatMap((release) => {
      return release.schemas;
    });
  const live = liveIds.map((id) => {
    return listing.byId.get(id);
  });
  // A live revision the listing does not show leaves its methods unknown.
  const known = live.filter((info): info is SchemaInfo => {
    return info !== undefined;
  });
  if (known.length !== live.length) {
    return { changes: [], unreadable: true };
  }
  const newest = autoPinned.flatMap(
    (objectType): readonly (readonly [string, readonly Credential[]])[] => {
      const info = listing.byObjectType.get(objectType);
      if (info === undefined) {
        return [];
      }
      return [[objectType, info.methods]];
    },
  );
  const after = [...bundled, ...newest];
  const changes = after.flatMap((entry): readonly MethodChange[] => {
    const objectType = entry[0];
    const kept = entry[1];
    const enabled = known
      .filter((info) => {
        return info.objectType === objectType;
      })
      .flatMap((info) => {
        return info.methods;
      });
    const disabled = [...new Set(enabled)].filter((method) => {
      return !kept.includes(method);
    });
    if (disabled.length === 0) {
      return [];
    }
    return [{ objectType, disabled, kept }];
  });
  return { changes, unreadable: false };
}

/**
 * The releases live on the primary origins: whether each pins a flow, and the
 * schema revisions it pins.
 *
 * @param ctx - The step's context.
 * @returns The releases, or nothing when they could not be read.
 * @throws When the person stopped the command.
 */
async function liveReleases(ctx: StepContext): Promise<readonly LiveRelease[] | undefined> {
  try {
    const deployments = await ctx.deployments.primary({ expand: ["release"] });
    return deployments.flatMap((deployment): readonly LiveRelease[] => {
      const pointers = deployment.release?.pointers;
      if (pointers === undefined) {
        return [];
      }
      const pinsFlow = pointers.some((pointer) => {
        return pointer.kind === "flow_definition";
      });
      const schemas = pointers
        .filter((pointer) => {
          return pointer.kind === "schema";
        })
        .map((pointer) => {
          return pointer.revision_id;
        });
      return [{ pinsFlow, schemas }];
    });
  } catch (error) {
    if (isCancellation(error)) {
      throw error;
    }
    return undefined;
  }
}

/**
 * Users who hold a credential of a method their schema loses and none of a
 * method it keeps.
 *
 * @remarks
 * A user who holds no credential at all could not sign in before either, so
 * is not counted. The credential reads are a few requests per user, so only
 * the first users are asked, and the count says so.
 *
 * @param ctx - The step's context.
 * @param changes - The schemas losing a method.
 * @param share - The most users this scan reads per schema.
 * @returns What the scan found.
 */
async function credentialWarnings(
  ctx: StepContext,
  changes: readonly MethodChange[],
  share: number,
): Promise<Scan> {
  // One schema at a time, so at most CONCURRENCY users are read at once.
  const scans = await mapBounded(changes, 1, async (change): Promise<Scan> => {
    const objectType = change.objectType;
    const disabled = change.disabled;
    const kept = change.kept;
    try {
      const read = await readUsers(
        ctx,
        [{ field: "schema_object_type", operation: "equals", value: objectType }, ACTIVE],
        share,
      );
      const checked = read.users.slice(0, LINK_CHECKS);
      const partial = read.truncated || read.users.length > LINK_CHECKS;
      const asked = [...disabled, ...kept];
      // Its own boundary per user: one failed read must not discard the
      // counts of the others, so it only makes the count a lower bound.
      const held = await mapBounded(checked, CONCURRENCY, async (user) => {
        try {
          return await ctx.users.credentials(user.id, asked);
        } catch (error) {
          if (isCancellation(error)) {
            throw error;
          }
          return undefined;
        }
      });
      const failed = held.includes(undefined);
      const stranded = held.filter((credentials) => {
        if (credentials === undefined) {
          return false;
        }
        const losesOne = disabled.some((method) => {
          return credentials.has(method);
        });
        const keepsOne = kept.some((method) => {
          return credentials.has(method);
        });
        return losesOne && !keepsOne;
      }).length;
      if (stranded === 0) {
        const unsure = partial ? [quote(objectType)] : [];
        return { warnings: [], partial: unsure, failed };
      }
      const methods = disabled.join(" or ");
      const strandedCount = count(stranded, partial || failed);
      const userCount = count(read.users.length, read.truncated);
      const users = plural(read.users.length, "user");
      const keep = disabled.length === 1 ? methods : "them";
      return {
        warnings: [
          `${strandedCount} of ${userCount} existing ${users} of ${quote(objectType)} can only sign in with ${methods}, which this release disables, so they cannot sign in after it. Keep ${keep} enabled until they have another way in.`,
        ],
        partial: [],
        failed,
      };
    } catch (error) {
      if (isCancellation(error)) {
        throw error;
      }
      // One schema's failed read must not discard the warnings of the others.
      return { warnings: [], partial: [], failed: true };
    }
  });
  return merged(scans);
}

/**
 * The ways in a schema enables that a user holds a credential for.
 *
 * @remarks
 * SSO is one method: an identity link names a connection, not a provider
 * slug, so a schema that keeps any provider counts every linked user as
 * having a way in. A server revision is read as a schema file is, so both are
 * judged alike.
 *
 * @param schema - The schema, from the release or the project's listing.
 * @returns The usable methods among password, passkey and SSO.
 */
function credentialMethods(schema: UserSchema): readonly Credential[] {
  return schema.usableMethods.filter(isCredential);
}

/**
 * Whether a method is one a user can hold a credential for.
 *
 * @param method - A method a schema enables.
 * @returns Whether it is password, passkey or SSO.
 */
function isCredential(method: string): method is Credential {
  return CREDENTIALS.some((credential) => {
    return credential === method;
  });
}

/**
 * Read the users a query matches, a page at a time, up to a limit.
 *
 * @param ctx - The step's context.
 * @param filter - The query's filters.
 * @param max - The most users to read.
 * @param read - The users read so far, and the token of the next page.
 * @returns The users, and whether there were more.
 * @throws When a page cannot be read.
 */
async function readUsers(
  ctx: StepContext,
  filter: readonly UserFilter[],
  max: number,
  read: { readonly users: readonly QueriedUser[]; readonly pageToken?: string } = { users: [] },
): Promise<ReadUsers> {
  const pageToken = read.pageToken;
  const page = await ctx.users.page({
    limit: Math.min(PAGE_SIZE, max - read.users.length),
    filter: [...filter],
    page_token: pageToken,
  });
  const users = [...read.users, ...page.items];
  const next = page.next ?? undefined;
  // An empty page that still offers another is not progress.
  const more = next !== undefined && page.items.length > 0;
  if (!more || users.length >= max) {
    return { users, truncated: next !== undefined };
  }
  return readUsers(ctx, filter, max, { users, pageToken: next });
}

/**
 * The value at a dotted path, or `undefined` when a step along it is missing.
 *
 * @param node - Where the path starts.
 * @param keys - The path's keys.
 * @returns The value, or `undefined`.
 */
function valueAt(node: unknown, keys: readonly string[]): unknown {
  const key = keys[0];
  if (key === undefined) {
    return node;
  }
  if (!isObject(node) || !Object.hasOwn(node, key)) {
    return undefined;
  }
  return valueAt(node[key], keys.slice(1));
}

/**
 * Whether the user holds a value at the (dotted) attribute path.
 *
 * @param user - The user.
 * @param path - The dotted path.
 * @returns Whether a non-empty value is there.
 */
function carries(user: QueriedUser, path: string): boolean {
  const value = valueAt(user.attributes, path.split("."));
  return value !== undefined && value !== null && value !== "";
}

/**
 * The project's schemas, by revision id and by object type.
 *
 * @remarks
 * The API lists schemas newest first, so the first revision of an object type
 * is its newest. Timestamps are not compared: their fractional digits vary in
 * length, so they do not sort as text. An empty object type is kept, so a
 * schema that really has one is named as such rather than as unnamed. A
 * revision the schema contract refuses is read from its raw body, since it is
 * still what the server serves.
 *
 * @param ctx - The step's context.
 * @returns Each revision's object type, identifier and methods, by revision id
 *   and, for the newest revision, by object type.
 * @throws {@link Error} When the schemas cannot be listed.
 */
async function objectTypes(ctx: StepContext): Promise<Listing> {
  const listed = await ctx.schemas.list();
  const revisions = listed.flatMap((entry): readonly (readonly [string, SchemaInfo])[] => {
    const listedBody = entry.schema;
    const body: JsonObject = isJsonValue(listedBody) && isJsonObject(listedBody) ? listedBody : {};
    const schema = UserSchema.read({ path: "", body });
    // A live revision is what the server serves, so the local contract's
    // refusal of it does not remove it; its raw body is read instead.
    const info = schema instanceof BrokenFile ? rawInfo(body) : typedInfo(schema);
    if (info === undefined) {
      return [];
    }
    return [[entry.id, info]];
  });
  const infos = revisions.map((revision) => {
    return revision[1];
  });
  const newest = infos.filter((info, index) => {
    const first = infos.findIndex((other) => {
      return other.objectType === info.objectType;
    });
    return first === index;
  });
  return {
    byId: new Map(revisions),
    byObjectType: new Map(
      newest.map((info) => {
        return [info.objectType, info];
      }),
    ),
  };
}

/**
 * A revision the schema contract accepts, as the project lists it.
 *
 * @param schema - The parsed schema.
 * @returns Its object type, identifier and methods, or nothing when it has no
 *   object type.
 */
function typedInfo(schema: UserSchema): SchemaInfo | undefined {
  const objectType = schema.body.objectType;
  if (typeof objectType !== "string") {
    return undefined;
  }
  return {
    objectType,
    identifier: schema.identifier,
    methods: credentialMethods(schema),
  };
}

/**
 * A revision the schema contract refuses, read leniently from its raw body.
 *
 * @remarks
 * The server's revision is what is live, so the local contract's strictness
 * does not apply to it. The object type, the designated identifier and the
 * methods enabled in `x-auth-methods` are read as the contract would read
 * them, wherever the body has them in the right shape. SSO counts only with
 * a provider listed.
 *
 * @param body - The revision's raw body.
 * @returns Its object type, identifier and methods, or nothing when it has no
 *   object type.
 */
function rawInfo(body: JsonObject): SchemaInfo | undefined {
  const objectType = body.objectType;
  if (typeof objectType !== "string") {
    return undefined;
  }
  const identifier = body["x-identifier"];
  const listed = body["x-auth-methods"];
  const authMethods: JsonObject = listed !== undefined && isJsonObject(listed) ? listed : {};
  const methods = CREDENTIALS.filter((method) => {
    const entry = authMethods[method];
    if (entry === undefined || !isJsonObject(entry) || entry.enabled !== true) {
      return false;
    }
    if (method !== "sso") {
      return true;
    }
    return Array.isArray(entry.providers) && entry.providers.length > 0;
  });
  return {
    objectType,
    identifier: typeof identifier === "string" && identifier.trim() !== "" ? identifier : undefined,
    methods: [...methods].sort(),
  };
}

/**
 * A name as a warning quotes it.
 *
 * @param value - The name.
 * @returns The name in double quotes.
 */
function quote(value: string): string {
  return `"${value}"`;
}

/**
 * A noun in the number a count calls for.
 *
 * @param n - The count.
 * @param noun - The noun in the singular.
 * @returns The noun, with an `s` unless the count is one.
 */
function plural(n: number, noun: string): string {
  if (new Intl.PluralRules("en").select(n) === "one") {
    return noun;
  }
  return `${noun}s`;
}

/**
 * A count, as a lower bound when it was only partly read.
 *
 * @param n - The count.
 * @param truncated - Whether it is only a lower bound.
 * @returns The count in words.
 */
function count(n: number, truncated: boolean): string {
  if (truncated) {
    return `at least ${n}`;
  }
  return `${n}`;
}
