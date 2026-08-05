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
 *                                       --SUBMIT(recover)--> recover --SUBMIT--> identifier
 *                                       --SUBMIT(register)--> register
 *                                       --SUBMIT(passkey)--> passkey-login
 *                                       --SUBMIT(sso_provider_id)--> sso-redirect
 *                            password   --SUBMIT(submit)--> done
 *                                       --SUBMIT(back)----> identifier
 *                                       --SUBMIT(passkey)--> passkey-login
 *      \--START(register)--> register --SUBMIT--> register-password --SUBMIT--> done
 *                                     --SUBMIT(sign_in)--> identifier
 *
 *   passkey-upsell / passkey-setup -- legacy upsell pair; the default flow no
 *               longer routes through them (passkey registration is offered
 *               up front instead). Kept so tests can target them directly
 *               via actor injection.
 *   passkey-upsell --SUBMIT(skip)--> done
 *   passkey-upsell --SUBMIT(*)----> passkey-setup --SUBMIT--> done
 *   passkey-login --SUBMIT--> done
 *   passkey-login --SUBMIT(cancel)--> identifier
 *   sso-redirect --SUBMIT--> done
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
  | "done";

export type FlowMachineContext = {
  tokenSeq: number;
  sessionToken: string;
  purpose: CreateFlowBodyPurpose | null;
  capturedFields: Record<string, string>;
  ssoProviderId: string | null;
};

export type FlowMachineEvent =
  | { type: "START"; purpose: CreateFlowBodyPurpose }
  | {
      type: "SUBMIT";
      action: string;
      fields: Record<string, string>;
      sso_provider_id?: string | null;
    }
  | { type: "RESET" };

const initialContext = {
  tokenSeq: 0,
  sessionToken: "tok_mock_0",
  purpose: null,
  capturedFields: {},
  ssoProviderId: null,
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
  FlowMachineEvent & { type: "SUBMIT" },
  undefined,
  FlowMachineEvent,
  never
>({
  capturedFields: ({ context, event }) => ({ ...context.capturedFields, ...event.fields }),
});

const setPurpose = assign<
  FlowMachineContext,
  FlowMachineEvent & { type: "START" },
  undefined,
  FlowMachineEvent,
  never
>({
  purpose: ({ event }) => event.purpose,
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
          {
            guard: ({ event }) =>
              typeof event.sso_provider_id === "string" && event.sso_provider_id.length > 0,
            target: "sso-redirect",
            actions: [
              captureFields,
              assign({ ssoProviderId: ({ event }) => event.sso_provider_id ?? null }),
              rotateToken,
            ],
          },
          {
            guard: ({ event }) => event.action === "register",
            target: "register",
            actions: [captureFields, rotateToken],
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
            actions: [captureFields, rotateToken],
          },
        ],
      },
    },
    register: {
      on: {
        SUBMIT: [
          {
            guard: ({ event }) => event.action === "sign_in",
            target: "identifier",
            actions: [captureFields, rotateToken],
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
          {
            // ADR 022 back-navigation: the engine injects a `back` action on
            // any step that has a predecessor.
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
    "sso-redirect": {
      on: {
        SUBMIT: { target: "done", actions: [rotateToken] },
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
