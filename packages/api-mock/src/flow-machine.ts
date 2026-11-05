/**
 * XState machine that walks a happy-path login flow.
 *
 * The mock backend's job is to advance through the canonical Zitadel
 * authentication flow without performing any real authentication work.
 * State names are deliberately the canonical wire step names (matching
 * `CreateFlow201Step.name`) so handlers can use the snapshot value directly
 * as the fixture key.
 *
 * The graph mirrors the real default login flow
 * (`packages/config/defaults/default-login.json`): sign-in is **split** across
 * `identifier` (email) then `password`. It deliberately used to be a single
 * combined card, which meant every consumer of this mock exercised a screen the
 * server never emits — see this package's AGENTS.md.
 *
 * State graph:
 *
 *   idle --START(login)----> identifier (email only)
 *                                       --SUBMIT(submit)--> password
 *                                       --SUBMIT(submit, user_not_found)--> register
 *                                       --SUBMIT(recover)--> recover --SUBMIT--> identifier
 *                                       --SUBMIT(register)--> register
 *                                       --SUBMIT(passkey)--> passkey-login
 *                                       --SUBMIT(sso)-----> sso-redirect
 *                            password   --SUBMIT(submit)--> done
 *                                       --SUBMIT(back)----> the step that handed off to it
 *                                       --SUBMIT(passkey)--> passkey-login
 *                                       --SUBMIT(sso)-----> sso-redirect
 *      \--START(register)--> register --SUBMIT--> register-password --SUBMIT--> done
 *                                     --SUBMIT(submit, user_already_exists)--> password
 *                                     --SUBMIT(sign_in)--> identifier
 *                                     --SUBMIT(sso)-----> sso-redirect
 *
 *   The `user_*` outcomes are the email lookup the handlers make when
 *   `setupMockHandlers({ accounts })` opts in; without it no submit carries one.
 *
 *   passkey-upsell / passkey-setup -- legacy upsell pair; the default flow no
 *               longer routes through them (passkey registration is offered
 *               up front instead). Kept so tests can target them directly
 *               via actor injection.
 *   passkey-upsell --SUBMIT(skip)--> done
 *   passkey-upsell --SUBMIT(*)----> passkey-setup --SUBMIT--> done
 *   passkey-login --SUBMIT--> done
 *   passkey-login --SUBMIT(cancel)--> identifier
 *   sso-redirect --PROVIDER_RETURN--> register-sso | sso-conflict | done
 *                --PROVIDER_RETURN(error)--> the step that chose the provider
 *   sso-conflict --SUBMIT(sso)-----> sso-redirect
 *   anything --RESET--> .idle  (root on: uses child-relative target syntax)
 */
import type { CreateFlowBodyPurpose } from "@zitadel/api/generated/model";
import { createMachine, type Actor, assign, createActor } from "xstate";

export type FlowStepName =
  | "identifier"
  | "register"
  | "register-password"
  | "password"
  | "recover"
  | "passkey-upsell"
  | "passkey-setup"
  | "passkey-login"
  | "sso-redirect"
  | "register-sso"
  | "sso-conflict"
  | "done";

/**
 * What the provider's return resolved to, decided by the caller rather than
 * here.
 *
 * The real engine works this out from the identity the provider returned: a
 * subject already linked signs in, an unknown subject registers, and an email
 * that already has an account collides. That is a lookup, not a state
 * transition, so the machine takes the answer and routes on it — the same split
 * the engine has.
 */
export type SsoOutcome = "sso_authenticated" | "sso_user_not_found" | "user_already_exists";

/**
 * How the provider's return ended: an identity to route on, or `error` when the
 * provider declined or the callback failed. Which error key the step shows is
 * the callback's business, not the machine's; the machine only goes back.
 */
type SsoReturn = SsoOutcome | "error";

/** The steps that offer provider buttons, and so the steps a failed return goes back to. */
type SsoOrigin = "identifier" | "register" | "password" | "sso-conflict";

export type FlowMachineContext = {
  tokenSeq: number;
  sessionToken: string;
  purpose: CreateFlowBodyPurpose | null;
  capturedFields: Record<string, string>;
  ssoProviderId: string | null;
  /** The step the provider button was pressed on, which decides where a return from it goes. */
  ssoOrigin: SsoOrigin | null;
  /**
   * The step that handed off to `password`, where its `back` returns. The
   * engine pops its back stack there, restoring that step's purpose too.
   */
  passwordFrom: "identifier" | "register";
};

export type FlowMachineEvent =
  | { type: "START"; purpose: CreateFlowBodyPurpose }
  | {
      type: "SUBMIT";
      action: string;
      fields: Record<string, string>;
      sso_provider_id?: string | null;
      outcome?: "user_not_found" | "user_already_exists";
    }
  | {
      // The provider sending the browser back to the callback. It is not a
      // SUBMIT because no client sends it: the engine's callback route is a
      // plain GET the provider redirects to.
      type: "PROVIDER_RETURN";
      fields: Record<string, string>;
      outcome?: SsoReturn | null;
    }
  | { type: "RESET" };

const initialContext = {
  tokenSeq: 0,
  sessionToken: "tok_mock_0",
  purpose: null,
  capturedFields: {},
  ssoProviderId: null,
  ssoOrigin: null,
  passwordFrom: "identifier",
} satisfies FlowMachineContext;

const rotateToken = assign<
  FlowMachineContext,
  FlowMachineEvent,
  undefined,
  FlowMachineEvent,
  never
>({
  tokenSeq: ({ context }) => context.tokenSeq + 1,
  sessionToken: ({ context }) => `tok_mock_${context.tokenSeq + 1}`,
});

const captureFields = assign<
  FlowMachineContext,
  FlowMachineEvent & { type: "SUBMIT" | "PROVIDER_RETURN" },
  undefined,
  FlowMachineEvent,
  never
>({
  capturedFields: ({ context, event }) => ({ ...context.capturedFields, ...event.fields }),
});

/**
 * Choosing a provider is the reserved `sso` action: it carries
 * `sso_provider_id` and leaves for the provider's authorization endpoint,
 * whatever step offered the button. Every state the engine attaches
 * `sso_providers` to (`PROVIDER_STEPS` in `sso-providers.ts`) takes this
 * transition first, ahead of that step's own actions — otherwise a click
 * falls through to the step's default and the mock reports a journey that
 * could not happen.
 *
 * Both halves are required, because both are the contract
 * (`docs/design/idp/3-social-login-flow.md`): `{action: "sso",
 * sso_provider_id}`. A `submit` that happens to carry a provider id is a
 * malformed request the engine would treat as an ordinary submit, so routing
 * it here would let a caller pass against the mock and fail against the
 * engine.
 */
type SubmitEvent = Extract<FlowMachineEvent, { type: "SUBMIT" }>;
type ProviderReturnEvent = Extract<FlowMachineEvent, { type: "PROVIDER_RETURN" }>;

/**
 * The transition every step that offers providers takes when one is pressed.
 * The step is remembered because the engine never leaves it: `sso-redirect` is
 * a response, not a step, and a failed return shows the step that offered the
 * button again with the error on it.
 */
const chooseProviderOn = (origin: SsoOrigin) =>
  ({
    guard: ({ event }: { event: SubmitEvent }) =>
      event.action === "sso" &&
      typeof event.sso_provider_id === "string" &&
      event.sso_provider_id.length > 0,
    target: "sso-redirect",
    actions: [
      captureFields,
      assign<FlowMachineContext, SubmitEvent, undefined, FlowMachineEvent, never>({
        ssoProviderId: ({ event }) => event.sso_provider_id ?? null,
        ssoOrigin: () => origin,
      }),
      rotateToken,
    ],
  }) as const;

/** A failed return, back to the step the provider was chosen on. */
const failedReturnTo = (origin: SsoOrigin) =>
  ({
    guard: ({ event, context }: { event: ProviderReturnEvent; context: FlowMachineContext }) =>
      event.outcome === "error" && context.ssoOrigin === origin,
    target: origin,
    actions: [rotateToken],
  }) as const;

const setPurpose = assign<
  FlowMachineContext,
  FlowMachineEvent & { type: "START" },
  undefined,
  FlowMachineEvent,
  never
>({
  purpose: ({ event }) => event.purpose,
});

const changePurpose = (purpose: CreateFlowBodyPurpose) =>
  assign<FlowMachineContext, FlowMachineEvent, undefined, FlowMachineEvent, never>({
    purpose: () => purpose,
  });

const handOffToPassword = (from: FlowMachineContext["passwordFrom"]) =>
  assign<FlowMachineContext, FlowMachineEvent, undefined, FlowMachineEvent, never>({
    passwordFrom: () => from,
  });

export const flowMachine = createMachine({
  types: {} as {
    context: FlowMachineContext;
    events: FlowMachineEvent;
  },
  id: "flow",
  initial: "idle",
  context: initialContext,
  on: {
    RESET: {
      target: ".idle",
      actions: assign(() => ({ ...initialContext })),
    },
  },
  states: {
    idle: {
      on: {
        START: [
          {
            guard: ({ event }) => event.purpose === "register",
            target: "register",
            actions: [setPurpose, rotateToken],
          },
          {
            target: "identifier",
            actions: [setPurpose, rotateToken],
          },
        ],
      },
    },
    identifier: {
      on: {
        SUBMIT: [
          chooseProviderOn("identifier"),
          {
            // The visitor's own switch, or the engine's for an unknown email.
            guard: ({ event }) =>
              event.action === "register" ||
              (event.action === "submit" && event.outcome === "user_not_found"),
            target: "register",
            actions: [captureFields, changePurpose("register"), rotateToken],
          },
          {
            guard: ({ event }) => event.action === "passkey",
            target: "passkey-login",
            actions: [captureFields, rotateToken],
          },
          {
            guard: ({ event }) => event.action === "recover",
            target: "recover",
            actions: [captureFields, rotateToken],
          },
          {
            // Default `submit`: hand off to the password step, as the real
            // flow's `submit -> password` transition does.
            target: "password",
            actions: [captureFields, handOffToPassword("identifier"), rotateToken],
          },
        ],
      },
    },
    register: {
      on: {
        SUBMIT: [
          chooseProviderOn("register"),
          {
            guard: ({ event }) => event.action === "sign_in",
            target: "identifier",
            actions: [captureFields, changePurpose("login"), rotateToken],
          },
          {
            guard: ({ event }) =>
              event.action === "submit" && event.outcome === "user_already_exists",
            target: "password",
            actions: [
              captureFields,
              changePurpose("login"),
              handOffToPassword("register"),
              rotateToken,
            ],
          },
          {
            target: "register-password",
            actions: [captureFields, rotateToken],
          },
        ],
      },
    },
    "register-password": {
      on: {
        SUBMIT: [
          {
            guard: ({ event }) => event.action === "back",
            target: "register",
            actions: [rotateToken],
          },
          { target: "done", actions: [captureFields, rotateToken] },
        ],
      },
    },
    recover: {
      on: {
        SUBMIT: { target: "identifier", actions: [rotateToken] },
      },
    },
    password: {
      on: {
        SUBMIT: [
          chooseProviderOn("password"),
          {
            // ADR 022 back-navigation: the engine injects a `back` action on
            // any step that has a predecessor. After the switch from sign-up,
            // that is `register`, and going back is signing up again.
            guard: ({ event, context }) =>
              event.action === "back" && context.passwordFrom === "register",
            target: "register",
            actions: [changePurpose("register"), rotateToken],
          },
          {
            guard: ({ event }) => event.action === "back",
            target: "identifier",
            actions: [rotateToken],
          },
          {
            guard: ({ event }) => event.action === "passkey",
            target: "passkey-login",
            actions: [captureFields, rotateToken],
          },
          {
            target: "done",
            actions: [captureFields, rotateToken],
          },
        ],
      },
    },
    "passkey-upsell": {
      on: {
        SUBMIT: [
          {
            guard: ({ event }) => event.action === "skip",
            target: "done",
            actions: [rotateToken],
          },
          {
            target: "passkey-setup",
            actions: [rotateToken],
          },
        ],
      },
    },
    "passkey-setup": {
      on: {
        SUBMIT: { target: "done", actions: [rotateToken] },
      },
    },
    "passkey-login": {
      on: {
        SUBMIT: [
          {
            guard: ({ event }) => event.action === "cancel",
            target: "identifier",
            actions: [rotateToken],
          },
          {
            target: "done",
            actions: [captureFields, rotateToken],
          },
        ],
      },
    },
    // Returning from the provider. The three branches are area 3's resolution
    // branches, and the caller says which one applies. Only the callback
    // leaves this state: there is no client action that does.
    "sso-redirect": {
      on: {
        PROVIDER_RETURN: [
          failedReturnTo("identifier"),
          failedReturnTo("register"),
          failedReturnTo("password"),
          failedReturnTo("sso-conflict"),
          {
            // From the password step the attempt is already bound to the
            // identified user, so the engine restarts the flow instead of
            // collecting a new account.
            guard: ({ context, event }) =>
              event.outcome === "sso_user_not_found" && context.ssoOrigin === "password",
            target: "identifier",
            actions: [rotateToken],
          },
          {
            // Both outcomes move the purpose as the engine's implicit flip
            // does: a new identity signs up, a colliding one signs in.
            guard: ({ event }) => event.outcome === "sso_user_not_found",
            target: "register-sso",
            actions: [captureFields, changePurpose("register"), rotateToken],
          },
          {
            guard: ({ event }) => event.outcome === "user_already_exists",
            target: "sso-conflict",
            actions: [captureFields, changePurpose("login"), rotateToken],
          },
          {
            // `sso_authenticated`: a subject already linked to an account, so the round
            // trip is the whole sign-in. Guarded, so only this outcome reaches
            // it.
            guard: ({ event }) => event.outcome === "sso_authenticated",
            target: "done",
            actions: [captureFields, rotateToken],
          },
          {
            // No outcome at all. Failing closed: the worst reading of "we
            // could not tell who came back" is to sign someone in, so an
            // unresolved return registers instead.
            target: "register-sso",
            actions: [captureFields, changePurpose("register"), rotateToken],
          },
        ],
      },
    },

    // A new external identity. The step collects whatever the schema needs
    // that the provider did not supply, and its submit is the flow's
    // `create_user_with_sso`.
    "register-sso": {
      on: {
        SUBMIT: [
          {
            guard: ({ event }) => event.action === "sign_in",
            target: "identifier",
            actions: [changePurpose("login"), rotateToken],
          },
          { target: "done", actions: [captureFields, rotateToken] },
        ],
      },
    },

    // The provider's email already has an account, so the user proves they own
    // it with a method this schema enables rather than getting a second one.
    "sso-conflict": {
      on: {
        SUBMIT: [
          chooseProviderOn("sso-conflict"),
          {
            guard: ({ event }) => event.action === "passkey",
            target: "passkey-login",
            actions: [captureFields, rotateToken],
          },
          {
            // The scaffold declares `purpose: login` on this transition.
            guard: ({ event }) => event.action === "sign_in",
            target: "identifier",
            actions: [changePurpose("login"), rotateToken],
          },
          { target: "done", actions: [captureFields, rotateToken] },
        ],
      },
    },
    done: { type: "final" },
  },
});

/** The concrete actor type produced by {@link startFlowActor}. */
export type FlowActor = Actor<typeof flowMachine>;

/**
 * Create and start a new actor for {@link flowMachine}.
 *
 * The actor begins in the `idle` state with a fresh context. Callers in
 * `setupMockHandlers()` replace the actor reference on every `createFlow`
 * request rather than resetting it, because the `done` state is final and
 * cannot be exited via an event.
 *
 * @returns A running actor ready to receive `START` and `SUBMIT` events.
 */
export function startFlowActor(): FlowActor {
  const actor = createActor(flowMachine);
  actor.start();
  return actor;
}
