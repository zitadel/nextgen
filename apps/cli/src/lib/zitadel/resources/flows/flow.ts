import type { ConnectionSlug } from "@zitadel/config/idp";

import { basename } from "node:path";

import { flowConfigSchema } from "@zitadel/config/schemas";

import {
  type FlowName,
  flowName,
  type SchemaReference,
  schemaReference,
  type StepName,
} from "@/lib/zitadel/names";
import type { BrokenFile } from "@/lib/zitadel/resources/broken";
import {
  ConfigDocument,
  type DocumentContract,
  type DocumentFile,
  type ReadableFile,
  type DocumentStatus,
  type Edit,
} from "@/lib/zitadel/resources/document";
import { SsoGenerator } from "@/lib/zitadel/resources/flows/sso";
import { Step } from "@/lib/zitadel/resources/flows/step";
import {
  type FlowValue,
  type IncomingTransition,
  LOGIN_LEAVING_OUTCOMES,
  type MethodUsage,
  type MethodUse,
  PASSKEY_ACTION_KINDS,
  PASSWORD_FIELD,
  type PasskeyActionKind,
  REGISTER_SSO_STEP,
  SSO_CONFLICT_STEP,
} from "@/lib/zitadel/resources/flows/types";
import type {
  EnabledMethods,
  SignInMethod,
  ToggleableMethod,
} from "@/lib/zitadel/resources/schemas/types";
import type { ConfigStore } from "@/lib/zitadel/storage/types";
import type { JsonObject } from "@/lib/zitadel/types";
import { walk } from "@/lib/zitadel/utils/graph";
import { isJsonObject } from "@/lib/zitadel/utils/json";

/**
 * A platform schema id, as the server's `isUserSchemaID` tells one apart.
 */
const PLATFORM_SCHEMA_ID = /^sch_./;

/**
 * A URL, which is a schema's `$id`, as the server's `isUserSchemaID` tells one apart.
 */
const SCHEMA_URL = /^[a-z][a-z0-9+.-]*:/i;

/**
 * The sign-in methods in the order a flow is asked about them.
 */
const OFFER_ORDER: readonly SignInMethod[] = ["password", "passkey", "sso"];

/**
 * A login flow under `.zitadel/flows/`: its steps and how they connect.
 */
export class Flow extends ConfigDocument<FlowValue> {
  /**
   * The contract a login flow is held to; a file it refuses is broken, with
   * one `contract/flow` finding per refusal.
   *
   * @remarks
   * The server's own flow rules need the flow's schema too, so they are not
   * part of it.
   */
  static readonly CONTRACT: DocumentContract<typeof flowConfigSchema> = {
    kind: "flow",
    rule: "contract/flow",
    schema: flowConfigSchema,
  };

  /**
   * Whether an action kind offers or enrols a passkey.
   *
   * @param kind - The action's kind, as written.
   * @returns Whether it is one of {@link PASSKEY_ACTION_KINDS}.
   */
  static isPasskeyActionKind(kind: string): kind is PasskeyActionKind {
    return PASSKEY_ACTION_KINDS.some((known) => {
      return known === kind;
    });
  }

  /**
   * What kind of document this is: a login flow.
   */
  readonly kind = "flow";

  /**
   * The flow's steps, each built once.
   */
  readonly steps: readonly Step[];

  /**
   * The steps by name, the first of a name kept, so a step is found without a scan.
   */
  private readonly stepsByName: ReadonlyMap<string, Step>;

  /**
   * Hold a flow the flow contract took.
   *
   * @param file - The project-relative path and the body as written.
   * @param value - What the contract parsed the body to.
   * @param status - Where it stands against the file on disk.
   */
  private constructor(file: DocumentFile, value: FlowValue, status: DocumentStatus) {
    super(file, value, status);
    this.steps = value.steps.map((step) => {
      return Step.of(step);
    });
    const byName = new Map<string, Step>();
    for (const step of this.steps) {
      if (!byName.has(step.name)) {
        byName.set(step.name, step);
      }
    }
    this.stepsByName = byName;
  }

  /**
   * Read a flow file: the flow, or the broken file it is.
   *
   * @param file - The file.
   * @returns The flow, marked as read, or the broken file.
   */
  static read(file: ReadableFile): Flow | BrokenFile {
    return Flow.readFile(Flow.CONTRACT, file, (value, parsed) => {
      return new Flow(parsed, value, "read");
    });
  }

  /**
   * Take a flow as read.
   *
   * @param file - The file.
   * @returns The flow, marked as read.
   * @throws {@link BrokenFilesError} When the flow contract refuses the body.
   */
  static of(file: DocumentFile): Flow {
    return Flow.build(file, "read");
  }

  /**
   * A new flow, not yet written: saving it never replaces a file already there.
   *
   * @param file - Where it goes, and what it holds.
   * @returns The flow, marked as created.
   * @throws {@link BrokenFilesError} When the flow contract refuses the body.
   */
  static create(file: DocumentFile): Flow {
    return Flow.build(file, "created");
  }

  /**
   * Make a flow of a body that must pass the flow contract, as every factory
   * and edit does.
   *
   * @param file - The project-relative path and the body.
   * @param status - Where it stands against the file on disk.
   * @returns The flow.
   * @throws {@link BrokenFilesError} When the flow contract refuses the body.
   */
  private static build(file: DocumentFile, status: DocumentStatus): Flow {
    return new Flow(file, Flow.parseFile(Flow.CONTRACT, file), status);
  }

  /**
   * Build the body the server receives: the flow as written.
   *
   * @param _store - Unused: a flow holds no `$file` references.
   * @returns The body without the editor-only `$schema` pointer.
   */
  toWireBody(_store: ConfigStore): JsonObject {
    return this.contractBody;
  }

  /**
   * The file's name without `.json`.
   *
   * @returns The name.
   */
  get name(): string {
    return basename(this.path, ".json");
  }

  /**
   * The name a release pins the flow by: its `name`, which its file name
   * need not match.
   *
   * @returns The name.
   */
  get handle(): FlowName {
    return flowName(this.value.name);
  }

  /**
   * Whether the flow can sign anyone in.
   *
   * @returns True when it has a `login` entry.
   */
  get servesLogin(): boolean {
    return this.value.purposes.login !== undefined;
  }

  /**
   * What `user_schema` names.
   *
   * @remarks
   * The contract takes an empty `user_schema`, which names no schema.
   *
   * @returns The reference, or `undefined` when it is empty.
   */
  get userSchema(): SchemaReference | undefined {
    const reference = this.value.user_schema;
    if (reference === "") {
      return undefined;
    }
    return schemaReference(reference);
  }

  /**
   * Whether `user_schema` names the schema by an id rather than by its
   * `objectType`.
   *
   * @remarks
   * Told apart as the server's `isUserSchemaID` does: a platform id
   * (`sch_…`) or a URL, which is a schema's `$id`.
   *
   * @returns True for an id; false for an `objectType` or no reference at all.
   */
  get namesSchemaById(): boolean {
    const reference = this.userSchema;
    if (reference === undefined) {
      return false;
    }
    return PLATFORM_SCHEMA_ID.test(reference) || SCHEMA_URL.test(reference);
  }

  /**
   * Whether a step offers any provider.
   *
   * @returns Whether some step lists a provider.
   */
  get offersSso(): boolean {
    return this.steps.some((step) => {
      return step.providers.length > 0;
    });
  }

  /**
   * The steps enabling a provider adds that the flow carries.
   *
   * @remarks
   * They cannot be told apart from a developer's own, so disabling keeps them
   * and names them.
   *
   * @returns Their names; none when the flow has none of them.
   */
  get generatedSsoSteps(): readonly StepName[] {
    return [REGISTER_SSO_STEP, SSO_CONFLICT_STEP].filter((name) => {
      return this.findStep(name) !== undefined;
    });
  }

  /**
   * The steps reached from the login entry.
   *
   * @remarks
   * Only transitions that stay in the login purpose are followed: one with an
   * `action` goes to another flow, one into another purpose leaves the
   * journey, and some outcomes switch to registration on their own.
   *
   * @returns The steps reached, in the flow's order; none without a login entry.
   */
  get loginJourney(): readonly Step[] {
    const reached = walk(
      this.loginEntry,
      (step) => {
        return step.transitions.flatMap((transition) => {
          if (transition.kind !== "step" || LOGIN_LEAVING_OUTCOMES.has(transition.outcome)) {
            return [];
          }
          if (transition.purpose !== undefined && transition.purpose !== "login") {
            return [];
          }
          return this.findStep(transition.target) ?? [];
        });
      },
      (step) => {
        return step.name;
      },
    );
    const names = new Set(
      reached.map((visited) => {
        return visited.name;
      }),
    );
    return this.steps.filter((step) => {
      return names.has(step.name);
    });
  }

  /**
   * The fields collected on the way to signing in: every field a step of the
   * {@link loginJourney} asks for.
   *
   * @remarks
   * The journey follows the engine (`flow_state_machine.go`), not the wire
   * alone. A transition with an `action` is a cross-flow `switch` or `pivot`,
   * which leaves this flow; a declared `purpose` other than `login` re-purposes
   * the attempt; and `user_not_found` or `sso_user_not_found` switch a login to
   * registration on their own (`applyOutcomeFlip`), so the step they lead to is
   * a sign-up step even when the transition names no purpose. A transition
   * that declares `purpose: "login"` stays in the login, but the server holds
   * its target to the login entry, which is already on the way.
   *
   * @returns Each field once, in the order of the steps that ask for it.
   */
  get loginFields(): ReadonlySet<string> {
    return new Set(
      this.loginJourney.flatMap((step) => {
        return step.fields;
      }),
    );
  }

  /**
   * Find the sign-in methods (`password`, `passkey`, `sso`) the flow lets an
   * existing user sign in with.
   *
   * @remarks
   * Only the steps of the {@link loginJourney} count, and only while the flow
   * is served; a passkey only through a `passkey` action, since
   * `passkey_register` signs nobody in; SSO only through one of the given
   * providers.
   *
   * @param providers - The providers the schema enables.
   * @returns The methods, in the order password, passkey, sso.
   */
  findOfferedMethods(providers: readonly string[]): readonly SignInMethod[] {
    const journey = this.servesLogin ? this.loginJourney : [];
    const signsIn = {
      password: (step: Step) => {
        return step.fields.includes(PASSWORD_FIELD);
      },
      passkey: (step: Step) => {
        return step.actions.some((action) => {
          return action.kind === "passkey";
        });
      },
      sso: (step: Step) => {
        return step.providers.some((provider) => {
          return providers.includes(provider);
        });
      },
    } as const satisfies Record<SignInMethod, (step: Step) => boolean>;
    return OFFER_ORDER.filter((method) => {
      return journey.some(signsIn[method]);
    });
  }

  /**
   * Find the steps that use a method, a password field or a passkey action,
   * and what each would be without it.
   *
   * @param method - The method.
   * @param stillEnabled - The sign-in methods the schema enables without it: a
   *   passkey action or a provider list counts as kept only when its method is one.
   * @returns One entry per step that uses it, in the flow's order.
   */
  findMethodUses(method: ToggleableMethod, stillEnabled: readonly string[]): readonly MethodUse[] {
    const byPassword = method === "password";
    const purposes = Object.entries(this.value.purposes);
    return this.steps.flatMap((step): readonly MethodUse[] => {
      const passkeys = step.actions
        .filter((action) => {
          return Flow.isPasskeyActionKind(action.kind);
        })
        .map((action) => {
          return `action ${JSON.stringify(action.name)}`;
        });
      const usesIt = byPassword ? step.fields.includes(PASSWORD_FIELD) : passkeys.length > 0;
      if (!usesIt) {
        return [];
      }
      const fields = step.fields
        .filter((field) => {
          return !byPassword || field !== PASSWORD_FIELD;
        })
        .map((field) => {
          return `field ${JSON.stringify(field)}`;
        });
      const keepsPasskeys = byPassword && stillEnabled.includes("passkey");
      const passkeyKeeps = passkeys.map((action) => {
        return `passkey ${action}`;
      });
      const keptPasskeys = keepsPasskeys ? passkeyKeeps : [];
      const keepsProviders = stillEnabled.includes("sso") && step.providers.length > 0;
      const keptProviders = keepsProviders ? ["sso_providers"] : [];
      const keptGates = step.hasGates ? ["gates"] : [];
      const usage: MethodUsage = byPassword
        ? "collects password"
        : `offers passkey (${passkeys.join(", ")})`;
      const entryFor = purposes
        .filter((purpose) => {
          return purpose[1] === step.name;
        })
        .map((purpose) => {
          return purpose[0];
        });
      return [
        {
          step: step.name,
          uses: usage,
          keeps: [...fields, ...keptPasskeys, ...keptProviders, ...keptGates],
          entryFor,
          targetedBy: this.findTransitionsInto(step.name),
        },
      ];
    });
  }

  /**
   * Find the transitions of other steps that lead to a step.
   *
   * @remarks
   * A transition with an `action` leaves for another flow, so it leads to no
   * step of this one. One that names only a purpose leads to that purpose's
   * entry step.
   *
   * @param name - The step.
   * @returns Each transition, and the purpose it follows when it names one.
   */
  findTransitionsInto(name: StepName): readonly IncomingTransition[] {
    const purposes = this.value.purposes;
    return this.steps
      .filter((other) => {
        return other.name !== name;
      })
      .flatMap((other) => {
        return other.transitions.flatMap((transition): readonly IncomingTransition[] => {
          if (transition.kind === "step" && transition.target === name) {
            return [{ step: other.name, transition: transition.outcome }];
          }
          if (transition.kind === "purpose" && purposes[transition.purpose] === name) {
            return [
              { step: other.name, transition: transition.outcome, purpose: transition.purpose },
            ];
          }
          return [];
        });
      });
  }

  /**
   * Find the step with this name.
   *
   * @param name - The step's name.
   * @returns The step, or `undefined` when the flow has none by that name.
   */
  findStep(name: string): Step | undefined {
    return this.stepsByName.get(name);
  }

  /**
   * Whether a step offers a provider.
   *
   * @param slug - The provider, as a step lists it.
   * @returns Whether one does.
   */
  offers(slug: string): boolean {
    return this.steps.some((step) => {
      return step.providers.includes(slug);
    });
  }

  /**
   * Refuse a flow that an edit offering a provider could not write.
   *
   * @remarks
   * {@link withProvider} checks this itself; a caller checks it first only to
   * refuse before it asks anything.
   *
   * @throws {@link RefusedEditError} When a region the edit writes is not the
   *   shape it writes, or no step marks where a completed sign-in ends.
   */
  assertProviderEditable(): void {
    this.refuseUneditable(new SsoGenerator(this).editRefusal);
  }

  /**
   * The flow offering a provider on its entry steps, with the steps and routes
   * a provider round trip needs.
   *
   * @remarks
   * Regions edited by hand are left as they are, and the edit names them.
   *
   * @param slug - The provider.
   * @param methods - The methods the flow's schema enables.
   * @returns The edit: the edited flow, or this one when it already offers the
   *   provider, and the regions left alone.
   * @throws {@link RefusedEditError} When a region the edit writes is not the
   *   shape it writes.
   */
  withProvider(slug: ConnectionSlug, methods: EnabledMethods): Edit<Flow> {
    this.assertProviderEditable();
    const edit = new SsoGenerator(this).withProvider(slug, methods);
    if (!edit.changed) {
      return { document: this, changed: false, skipped: edit.skipped };
    }
    return {
      document: Flow.build(
        { path: this.path, body: { ...this.body, ...edit.document } },
        this.editedStatus,
      ),
      changed: true,
      skipped: edit.skipped,
    };
  }

  /**
   * The flow with fields added to the steps that ask a person for their
   * details.
   *
   * @remarks
   * Those are the step the register purpose starts at (`register` when the flow
   * names none), which is where a provider's new users are asked for their
   * details too, and the `register-sso` step, when they list their fields. A
   * field a step lists already is not added twice, and every other step is
   * left as it is.
   *
   * @param names - The fields to add.
   * @returns The edit: the edited flow, or this one when no step takes them.
   */
  withFields(names: readonly string[]): Edit<Flow> {
    const steps = this.body.steps;
    if (names.length === 0 || !Array.isArray(steps)) {
      return { document: this, changed: false, skipped: [] };
    }
    const asking: readonly string[] = [
      this.value.purposes.register ?? "register",
      REGISTER_SSO_STEP,
    ];
    const edited = steps.map((step) => {
      if (
        !isJsonObject(step) ||
        typeof step.name !== "string" ||
        !asking.includes(step.name) ||
        !Array.isArray(step.fields)
      ) {
        return step;
      }
      const fields = step.fields;
      const missing = names.filter((name) => {
        return !fields.includes(name);
      });
      return missing.length === 0 ? step : { ...step, fields: [...fields, ...missing] };
    });
    const unchanged = edited.every((step, at) => {
      return step === steps[at];
    });
    if (unchanged) {
      return { document: this, changed: false, skipped: [] };
    }
    return {
      document: Flow.build(
        { path: this.path, body: { ...this.body, steps: edited } },
        this.editedStatus,
      ),
      changed: true,
      skipped: [],
    };
  }

  /**
   * The flow without a provider on any step.
   *
   * @remarks
   * Removing writes no route, so it never refuses: the contract already holds
   * every step and provider list to the shape the edit writes.
   *
   * @param slug - The provider, as the steps list it.
   * @returns The edit: the edited flow, or this one when no step offers it.
   */
  withoutProvider(slug: string): Edit<Flow> {
    const edit = new SsoGenerator(this).withoutProvider(slug);
    if (!edit.changed) {
      return { document: this, changed: false, skipped: edit.skipped };
    }
    return {
      document: Flow.build(
        { path: this.path, body: { ...this.body, ...edit.document } },
        this.editedStatus,
      ),
      changed: true,
      skipped: edit.skipped,
    };
  }

  /**
   * The step the login purpose starts at, where the {@link loginJourney}
   * begins.
   *
   * @returns The login entry alone; none when the flow has no login entry, or
   *   no step by its name.
   */
  private get loginEntry(): readonly Step[] {
    const login = this.value.purposes.login;
    if (login === undefined) {
      return [];
    }
    const entry = this.findStep(login);
    if (entry === undefined) {
      return [];
    }
    return [entry];
  }
}
