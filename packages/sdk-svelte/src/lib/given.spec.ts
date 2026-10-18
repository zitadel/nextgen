import { describe, expect, it } from "vitest";

import { assignGiven } from "./given";

const widget = () => ({ heading: "Signed in as", variant: "widget", suppressHeader: false });

describe("assignGiven", () => {
  it("assigns only the props that are defined", () => {
    const el = widget();

    assignGiven(el, { heading: "Custom", variant: undefined });

    expect(el).toEqual({ heading: "Custom", variant: "widget", suppressHeader: false });
  });

  it("leaves the element's own value on a prop that was never given", () => {
    const el = widget();

    assignGiven(el, { heading: undefined });

    expect(el.heading).toBe("Signed in as");
  });

  it("restores the element's own value when a given prop becomes unset", () => {
    const el = widget();
    assignGiven(el, { heading: "Custom", suppressHeader: true });

    assignGiven(el, { heading: undefined, suppressHeader: undefined });

    expect(el).toEqual(widget());
  });

  it("keeps a falsy value that is given", () => {
    const el = widget();

    assignGiven(el, { heading: "", suppressHeader: false });

    expect(el.heading).toBe("");
  });

  it("remembers the original value across repeated override cycles", () => {
    const el = widget();

    assignGiven(el, { heading: "One" });
    assignGiven(el, { heading: "Two" });
    assignGiven(el, { heading: undefined });
    assignGiven(el, { heading: "Three" });
    assignGiven(el, { heading: undefined });

    expect(el.heading).toBe("Signed in as");
  });

  it("does not share saved values between two elements", () => {
    const first = widget();
    const second = { ...widget(), heading: "Other default" };
    assignGiven(first, { heading: "Custom" });
    assignGiven(second, { heading: "Custom" });

    assignGiven(first, { heading: undefined });
    assignGiven(second, { heading: undefined });

    expect([first.heading, second.heading]).toEqual(["Signed in as", "Other default"]);
  });
});
