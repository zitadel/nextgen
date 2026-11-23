import { describe, expect, it } from "vitest";

import { CANVAS_CARD_WIDTH, layoutFlowCanvas, stepSketch } from "./canvas";
import type { FlowDefinition, FlowStep } from "./model";

/** The shipped `default-login`, as `packages/config/defaults/default-login.json` writes it. */
const DEFAULT_LOGIN: FlowDefinition = {
  name: "default-login",
  user_schema: "human-user",
  purposes: { login: "identifier", register: "register" },
  steps: [
    {
      name: "identifier",
      fields: ["email"],
      actions: [
        { name: "submit", kind: "submit", primary: true },
        { name: "register", kind: "navigate" },
      ],
      transitions: {
        submit: { target: "password" },
        user_not_found: { target: "register" },
        register: { purpose: "register" },
      },
    },
    {
      name: "password",
      fields: ["x-auth-methods#password"],
      actions: [{ name: "submit", kind: "submit", primary: true }],
      transitions: { submit: { target: "done" } },
    },
    {
      name: "register",
      fields: ["email"],
      actions: [
        { name: "submit", kind: "submit", primary: true },
        { name: "sign_in", kind: "navigate" },
      ],
      transitions: {
        submit: { target: "register-password" },
        user_already_exists: { target: "password" },
        sign_in: { purpose: "login" },
      },
    },
    {
      name: "register-password",
      fields: ["x-auth-methods#password"],
      actions: [{ name: "submit", kind: "submit", primary: true }],
      on_success: "create_user",
      transitions: { submit: { target: "done" }, user_already_exists: { target: "password" } },
    },
    { name: "done", complete: "show" },
  ],
};

/** The first point of an SVG path. */
function start(path: string) {
  const [x, y] = (path.match(/^M([\d.-]+),([\d.-]+)/) ?? []).slice(1).map(Number);
  return { x, y };
}

/** Every y an SVG path names, its control points included. */
function ys(path: string) {
  return [...path.matchAll(/[\d.-]+,([\d.-]+)/g)].map((match) => Number(match[1]));
}

describe("stepSketch", () => {
  it("draws fields, buttons, providers and links in screen order", () => {
    const step: FlowStep = {
      name: "identifier",
      fields: ["email"],
      actions: [
        { name: "register", kind: "navigate" },
        { name: "submit", kind: "submit", primary: true },
      ],
      sso_providers: ["google"],
    };
    const sketch = stepSketch(step);
    expect(sketch.rows.map((row) => [row.kind, row.label])).toEqual([
      ["field", "email"],
      ["button", "submit"],
      ["divider", "or"],
      ["provider", "google"],
      ["link", "register"],
    ]);
    // Rows stack top to bottom inside the card.
    for (const [index, row] of sketch.rows.entries()) {
      const next = sketch.rows[index + 1];
      if (next) expect(next.top).toBeGreaterThanOrEqual(row.top + row.height);
    }
    expect(sketch.height).toBeGreaterThan(sketch.rows.at(-1)?.top ?? 0);
  });

  it("puts each action's port at the centre of its control", () => {
    const sketch = stepSketch(DEFAULT_LOGIN.steps[0] as FlowStep);
    const link = sketch.rows.find((row) => row.kind === "link");
    expect(sketch.ports.register).toBe((link?.top ?? 0) + (link?.height ?? 0) / 2);
  });

  it("gives on_success and complete a footer", () => {
    expect(stepSketch(DEFAULT_LOGIN.steps[3] as FlowStep).footer).toEqual({
      label: "on success",
      value: "create_user",
    });
    const done = stepSketch({ name: "done", complete: "show" });
    expect(done.rows).toEqual([]);
    expect(done.footer).toEqual({ label: "complete", value: "show" });
  });
});

describe("layoutFlowCanvas", () => {
  const canvas = layoutFlowCanvas(DEFAULT_LOGIN);
  const card = (name: string) => {
    const found = canvas.cards.find((entry) => entry.name === name);
    if (!found) throw new Error(`no card ${name}`);
    return found;
  };
  const edge = (id: string) => {
    const found = canvas.edges.find((entry) => entry.id === id);
    if (!found) throw new Error(`no edge ${id}`);
    return found;
  };

  it("draws a card per step and a pill per purpose", () => {
    expect(canvas.cards.map((entry) => entry.name)).toEqual([
      "identifier",
      "password",
      "register",
      "register-password",
      "done",
    ]);
    expect(canvas.pills.map((pill) => pill.purpose)).toEqual(["login", "register"]);
  });

  it("tells action, outcome, purpose and entry arrows apart", () => {
    expect(edge("identifier.submit")).toMatchObject({ kind: "action", label: "submit" });
    expect(edge("identifier.user_not_found")).toMatchObject({
      kind: "outcome",
      label: "user_not_found",
    });
    expect(edge("identifier.register")).toMatchObject({ kind: "purpose", label: "register" });
    expect(canvas.edges.filter((entry) => entry.kind === "entry")).toHaveLength(2);
  });

  it("lays steps out left to right and keeps each pill before its entry step", () => {
    expect(card("password").x).toBeGreaterThan(card("identifier").x);
    expect(card("done").x).toBeGreaterThan(card("register-password").x);
    // `register.sign_in` points back at `login`; it must not drag the pill
    // away from `identifier`.
    for (const [purpose, step] of Object.entries(DEFAULT_LOGIN.purposes)) {
      const pill = canvas.pills.find((entry) => entry.purpose === purpose);
      expect((pill?.x ?? Infinity) + (pill?.width ?? 0)).toBeLessThan(card(step as string).x);
    }
  });

  it("starts an action's arrow at its control", () => {
    const from = card("identifier");
    const at = start(edge("identifier.submit").path);
    expect(at.x).toBe(from.x + CANVAS_CARD_WIDTH);
    expect(at.y).toBe(from.y + (from.sketch.ports.submit ?? 0));
  });

  it("routes a purpose transition that points left under every card", () => {
    const back = edge("register.sign_in");
    const bottom = Math.max(...canvas.cards.map((entry) => entry.y + entry.sketch.height));
    expect(Math.max(...ys(back.path))).toBeGreaterThan(bottom);
    expect(canvas.height).toBeGreaterThan(Math.max(...ys(back.path)));
  });

  it("skips transitions with nothing on the canvas to point at", () => {
    const sparse = layoutFlowCanvas({
      name: "sparse",
      user_schema: "human-user",
      purposes: { login: "start" },
      steps: [
        {
          name: "start",
          actions: [{ name: "submit", kind: "submit" }],
          transitions: {
            submit: { target: "other-flow", action: "switch" },
            recover: { purpose: "recovery" },
          },
        },
      ],
    });
    expect(sparse.edges.map((entry) => entry.kind)).toEqual(["entry"]);
  });
});
