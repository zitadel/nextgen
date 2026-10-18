// @vitest-environment jsdom
import { render } from "@testing-library/vue";
import { describe, expect, it } from "vitest";
import { defineComponent, h, ref } from "vue";

import { useGivenProps } from "./given";

// A stand-in widget: class fields are its own defaults, and the kebab-case
// attribute is mirrored to its property the way a Lit element does.
class GivenWidget extends HTMLElement {
  static observedAttributes = ["post-sign-out-url"];
  heading = "Signed in as";
  variant = "widget";
  postSignOutUrl = "/signed-out";
  attributeChangedCallback(name: string, _old: string | null, value: string | null) {
    if (name === "post-sign-out-url") this.postSignOutUrl = value ?? "";
  }
}
customElements.define("given-widget", GivenWidget);

const Host = defineComponent({
  props: { values: { type: Object, default: () => ({}) } },
  setup(props, { expose }) {
    const element = ref<GivenWidget | null>(null);
    expose({ element });
    const given = useGivenProps("given-widget", element);
    return () => h("given-widget", { ref: element, ...given(props.values) });
  },
});

const widget = (container: Element, index = 0) =>
  container.querySelectorAll<GivenWidget>("given-widget")[index]!;

describe("useGivenProps", () => {
  it("passes on only the props that are defined", () => {
    const { container } = render(Host, {
      props: { values: { heading: "Custom", variant: undefined } },
    });

    expect([widget(container).heading, widget(container).variant]).toEqual(["Custom", "widget"]);
  });

  it("leaves the element's own value on a prop that was never given", async () => {
    const { container, rerender } = render(Host, { props: { values: { variant: "page" } } });

    await rerender({ values: { variant: "page", heading: undefined } });

    expect(widget(container).heading).toBe("Signed in as");
  });

  it("restores the element's own value when a given prop becomes unset", async () => {
    const { container, rerender } = render(Host, { props: { values: { heading: "Custom" } } });
    expect(widget(container).heading).toBe("Custom");

    await rerender({ values: { heading: undefined } });

    expect(widget(container).heading).toBe("Signed in as");
  });

  it("restores a property given through its kebab-case attribute", async () => {
    const { container, rerender } = render(Host, {
      props: { values: { "post-sign-out-url": "/bye" } },
    });
    expect(widget(container).postSignOutUrl).toBe("/bye");

    await rerender({ values: { "post-sign-out-url": undefined } });

    expect(widget(container).postSignOutUrl).toBe("/signed-out");
  });

  it("handles repeated set and clear cycles", async () => {
    const { container, rerender } = render(Host, { props: { values: { heading: "One" } } });

    await rerender({ values: { heading: undefined } });
    await rerender({ values: { heading: "Two" } });
    expect(widget(container).heading).toBe("Two");
    await rerender({ values: { heading: undefined } });

    expect(widget(container).heading).toBe("Signed in as");
  });

  it("does not share given props between two elements", async () => {
    const first = render(Host, { props: { values: { heading: "First" } } });
    const second = render(Host, { props: { values: { heading: "Second" } } });

    await first.rerender({ values: { heading: undefined } });

    expect([widget(first.container).heading, widget(second.container).heading]).toEqual([
      "Signed in as",
      "Second",
    ]);
  });
});
