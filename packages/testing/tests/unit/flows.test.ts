import type { Locator, Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import {
  flowAction,
  flowField,
  loginWithPasskey,
  loginWithPassword,
  registerWithPasskey,
  registerWithPassword,
} from "../../src/flows";

interface Op {
  op: "click" | "fill" | "waitFor";
  target: string;
  value?: string;
}

interface Harness {
  ops: Op[];
  visible: (target: string) => boolean;
  page: Page;
}

/**
 * Locator stand-in that records a structural descriptor instead of querying
 * a DOM: `.or()` joins descriptors with `|`, `.locator()` appends `>>`. The
 * descriptor equality asserts below therefore lock the exact selector
 * ladder — the widget's documented automation-hook contract.
 */
class FakeLocator {
  constructor(
    private readonly harness: Harness,
    readonly desc: string,
  ) {}
  or(other: Locator): FakeLocator {
    return new FakeLocator(this.harness, `${this.desc}|${(other as unknown as FakeLocator).desc}`);
  }
  first(): FakeLocator {
    return this;
  }
  locator(selector: string): FakeLocator {
    return new FakeLocator(this.harness, `${this.desc}>>${selector}`);
  }
  async click(): Promise<void> {
    this.harness.ops.push({ op: "click", target: this.desc });
  }
  async fill(value: string): Promise<void> {
    this.harness.ops.push({ op: "fill", target: this.desc, value });
  }
  async isVisible(): Promise<boolean> {
    return this.harness.visible(this.desc);
  }
  async waitFor(): Promise<void> {
    if (!this.harness.visible(this.desc)) {
      throw new Error(`timeout waiting for ${this.desc}`);
    }
    this.harness.ops.push({ op: "waitFor", target: this.desc });
  }
}

function fakePage(visible: (target: string) => boolean = () => false): Harness {
  const harness: Harness = { ops: [], visible, page: undefined as unknown as Page };
  const make = (desc: string) => new FakeLocator(harness, desc);
  harness.page = {
    getByTestId: (id: string) => make(`testid:${id}`),
    getByLabel: (label: RegExp) => make(`label:${label}`),
    getByRole: (role: string, options: { name: RegExp }) => make(`role:${role}:${options.name}`),
    locator: (selector: string) => make(`css:${selector}`),
  } as unknown as Page;
  return harness;
}

function desc(locator: Locator): string {
  return (locator as unknown as FakeLocator).desc;
}

// The documented hook ladder per action name: host testid, native shadow
// button/link testids, then the raw attributes (the recover link carries
// only `data-action`).
const action = (name: string) =>
  `testid:zitadel-action-${name}|testid:zitadel-action-${name}-button|` +
  `testid:zitadel-action-${name}-link|css:zl-button[action="${name}"], [data-action="${name}"]`;
const field = (name: string, label: string) =>
  `testid:zitadel-input-${name}|testid:zitadel-field-${name}>>input|label:${label}`;

const EMAIL = field("email", "/email/i");
const PASSWORD = field("password", "/password/i");
const REGISTRATION_STEP = `${action("passkey_register")}|role:heading:/create|register|sign up|no-account/i`;

describe("flowAction / flowField", () => {
  it("locks the documented action-hook ladder", () => {
    const fake = fakePage();
    expect(desc(flowAction(fake.page, "submit"))).toBe(action("submit"));
    expect(desc(flowAction(fake.page, "register", { name: /sign up/i }))).toBe(
      `${action("register")}|role:button:/sign up/i|role:link:/sign up/i`,
    );
  });

  it("locks the documented field-hook ladder and the opt-in label fallback", () => {
    const fake = fakePage();
    expect(desc(flowField(fake.page, "password", { label: /password/i }))).toBe(PASSWORD);
    expect(desc(flowField(fake.page, "givenName"))).toBe(
      "testid:zitadel-input-givenName|testid:zitadel-field-givenName>>input",
    );
  });
});

describe("loginWithPassword", () => {
  it("drives the default split identifier → password shape", async () => {
    const fake = fakePage();
    await loginWithPassword(fake.page, { email: "a@example.test", password: "pw" });

    expect(fake.ops).toEqual([
      { op: "fill", target: EMAIL, value: "a@example.test" },
      { op: "click", target: action("submit") },
      { op: "fill", target: PASSWORD, value: "pw" },
      { op: "click", target: action("submit") },
    ]);
  });

  it("skips the identifier submit when the flow renders a combined step", async () => {
    const fake = fakePage((target) => target.includes("zitadel-input-password"));
    await loginWithPassword(fake.page, { email: "a@example.test", password: "pw" });

    expect(fake.ops.map((op) => op.op)).toEqual(["fill", "fill", "click"]);
  });
});

describe("loginWithPasskey", () => {
  it("taps the entry passkey action directly without an email (one-tap)", async () => {
    const fake = fakePage();
    await loginWithPasskey(fake.page);

    expect(fake.ops).toEqual([{ op: "click", target: action("passkey") }]);
  });

  it("fills the identifier first when an email is given", async () => {
    const fake = fakePage();
    await loginWithPasskey(fake.page, { email: "a@example.test" });

    expect(fake.ops).toEqual([
      { op: "fill", target: EMAIL, value: "a@example.test" },
      { op: "click", target: action("passkey") },
    ]);
  });
});

describe("registration ceremonies", () => {
  // Default flow: split steps, so no password field until the final step;
  // the registration-step barrier and the optional email refill render.
  const defaultFlowVisibility = (target: string) => !target.includes("zitadel-input-password");

  it("registerWithPassword walks the default registration path", async () => {
    const fake = fakePage(defaultFlowVisibility);
    await registerWithPassword(fake.page, {
      email: "new@example.test",
      password: "pw",
      profile: [{ field: "givenName", value: "Ada", label: /given.?name/i }],
    });

    expect(fake.ops).toEqual([
      { op: "fill", target: EMAIL, value: "new@example.test" },
      { op: "click", target: action("submit") },
      { op: "waitFor", target: REGISTRATION_STEP },
      { op: "fill", target: EMAIL, value: "new@example.test" },
      { op: "fill", target: field("givenName", "/given.?name/i"), value: "Ada" },
      { op: "click", target: action("submit") },
      { op: "fill", target: PASSWORD, value: "pw" },
      { op: "click", target: action("submit") },
    ]);
  });

  it("registerWithPasskey takes the registration step's passkey action", async () => {
    const fake = fakePage(defaultFlowVisibility);
    await registerWithPasskey(fake.page, { email: "new@example.test" });

    expect(fake.ops).toEqual([
      { op: "fill", target: EMAIL, value: "new@example.test" },
      { op: "click", target: action("submit") },
      { op: "waitFor", target: REGISTRATION_STEP },
      { op: "fill", target: EMAIL, value: "new@example.test" },
      { op: "click", target: action("passkey_register") },
    ]);
  });

  it("takes an explicit register action when the entry step is combined", async () => {
    // Password visible on the entry step: submitting would attempt a
    // password sign-in, so the ceremony must use the register navigation.
    const fake = fakePage(
      (target) =>
        target.includes("zitadel-input-password") || target.includes("passkey_register"),
    );
    await registerWithPasskey(fake.page, { email: "new@example.test" });

    expect(fake.ops).toEqual([
      { op: "fill", target: EMAIL, value: "new@example.test" },
      { op: "click", target: action("register") },
      { op: "waitFor", target: REGISTRATION_STEP },
      { op: "click", target: action("passkey_register") },
    ]);
  });

  it("fails loudly when the registration step never renders", async () => {
    const fake = fakePage(() => false);
    await expect(
      registerWithPasskey(fake.page, { email: "new@example.test" }),
    ).rejects.toThrow(/timeout waiting for/);
  });
});
