/**
 * xstate machine that walks a happy-path login flow.
 *
 * The mock backend's job is just to advance through the canonical Zitadel
 * authentication flow without performing any real authentication work.
 * State names are deliberately the canonical wire step names (matching
 * `CreateFlow201Step.name`) so handlers can use the snapshot value directly
 * as the fixture key.
 *
 * State graph:
 *
 *   idle --START(login)----> identifier (email+password, Figma 6593:141985)
 *                                       --SUBMIT(submit|recover)--> passkey-upsell
 *                                       --SUBMIT(register)--> register
 *                                       --SUBMIT(passkey)--> passkey-login
 *                                       --SUBMIT(sso_provider_id)--> sso-redirect
 *      \--START(register)--> register --SUBMIT--> passkey-upsell
 *
 *   password -- legacy split step; kept for tests that target it directly
 *   passkey-upsell --SUBMIT(skip)--> done
 *   passkey-upsell --SUBMIT(*)----> passkey-setup --SUBMIT--> done
 *   passkey-login --SUBMIT--> done
 *   passkey-login --SUBMIT(cancel)--> identifier
 *   sso-redirect --SUBMIT--> done
 *   anything --RESET--> idle
 */
import type { CreateFlowBodyPurpose } from "@zitadel-nextgen/api/generated/model";
import { createMachine, type AnyActorRef, assign, createActor } from "xstate";

export type FlowStepName =
  | "identifier"
  | "register"
  | "password"
  | "passkey-upsell"
  | "passkey-setup"
  | "passkey-login"
  | "sso-redirect"
  | "done";

export type FlowMachineContext = {
  flowId: string;
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

const initialContext: FlowMachineContext = {
  flowId: "flow_mock",
  tokenSeq: 0,
  sessionToken: "tok_mock_0",
  purpose: null,
  capturedFields: {},
  ssoProviderId: null,
};

const rotateToken = assign<FlowMachineContext, FlowMachineEvent, undefined, FlowMachineEvent, never>({
  tokenSeq: ({ context }) => context.tokenSeq + 1,
  sessionToken: ({ context }) => `tok_mock_${context.tokenSeq + 1}`,
});

const captureFields = assign<FlowMachineContext, FlowMachineEvent & { type: "SUBMIT" }, undefined, FlowMachineEvent, never>({
  capturedFields: ({ context, event }) => ({ ...context.capturedFields, ...event.fields }),
});

const setPurpose = assign<FlowMachineContext, FlowMachineEvent & { type: "START" }, undefined, FlowMachineEvent, never>({
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
            target: "passkey-upsell",
            actions: [captureFields, rotateToken],
          },
          {
            target: "passkey-upsell",
            actions: [captureFields, rotateToken],
          },
        ],
      },
    },
    register: {
      on: {
        SUBMIT: { target: "passkey-upsell", actions: [captureFields, rotateToken] },
      },
    },
    password: {
      on: {
        SUBMIT: { target: "passkey-upsell", actions: [captureFields, rotateToken] },
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
            actions: [rotateToken],
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

export type FlowActor = AnyActorRef;

export function startFlowActor(): FlowActor {
  const actor = createActor(flowMachine);
  actor.start();
  return actor;
}
