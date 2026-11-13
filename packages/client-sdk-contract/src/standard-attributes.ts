import { type WidgetName, widgetNames, widgetTags } from "@zitadel/sdk-core/types";

import { describe, expect, it } from "vitest";

/** Attributes as the markup names them; `false` and `null` exercise the wrappers' coercion. */
export type Attributes = {
  readonly [name: string]: string | boolean | null | undefined;
};

/** A mounted widget: its container, its element as a consumer's ref reaches it, and a re-render. */
export interface MountedWidget {
  /** Where the widget is mounted; the widget elements it holds are HTMLElements. */
  readonly container: { querySelector(selectors: string): HTMLElement | null };
  ref(): Element | null | undefined;
  update(next: Attributes): Promise<void> | void;
}

/**
 * Per widget, the forwarded attributes its props do not accept as the SDK's
 * attribute type spells them: a key the props lack, or one they type otherwise.
 */
type Unaccepted<Forwarded, Props extends Record<WidgetName, object>> = {
  [W in WidgetName]: {
    [K in keyof Forwarded]-?: [Forwarded[K]] extends [
      K extends keyof Props[W] ? Props[W][K] : never,
    ]
      ? never
      : K;
  }[keyof Forwarded];
};

/** Per widget, the props it takes that no wrapper forwards as a standard attribute. */
type Unforwarded<Props extends Record<WidgetName, object>> = {
  [W in WidgetName]: Extract<"dir" | "classList" | "onClick", keyof Props[W]>;
};

/**
 * `true` when no widget has an offending key; otherwise the widgets that do,
 * each with its keys, so the SDK's type error names both.
 */
type NoneOf<Offending extends Record<WidgetName, PropertyKey>> = [Offending[WidgetName]] extends [
  never,
]
  ? true
  : { readonly [W in WidgetName as [Offending[W]] extends [never] ? never : W]: Offending[W] };

/**
 * `T` once the caller named the types, `never` when it left them to inference
 * (TypeScript takes explicit type arguments all or none, and an uninferred
 * `Forwarded` is `unknown`), so a call without them cannot pass vacuously.
 */
type Named<Forwarded, T> = unknown extends Forwarded ? never : T;

export interface StandardAttributeGlue<Forwarded, Props extends Record<WidgetName, object>> {
  /** Mounts a widget with `attributes`, named as the markup names them. */
  mountWidget(widget: WidgetName, attributes: Attributes): Promise<MountedWidget>;
  /**
   * The attributes this SDK leaves on the element when their prop is removed;
   * the case checks they stay, so an SDK that fixes one must drop it here.
   */
  readonly staleOnRemoval: readonly string[];
  /** `true`: type-checks only when every widget's props accept `Partial<Forwarded>`. */
  readonly accepted: Named<Forwarded, NoneOf<Unaccepted<Forwarded, Props>>>;
  /** `true`: type-checks only when no widget's props take `dir`, `classList` or `onClick`. */
  readonly rejected: Named<Forwarded, NoneOf<Unforwarded<Props>>>;
}

export function cssProperties(style: string): Record<string, string> {
  const [property = "", value = ""] = style.split(":").map((part) => part.trim());
  return { [property]: value };
}

/**
 * Checks that each widget hands its element the standard HTML attributes, with
 * the SDK's own attribute and props types named: `Forwarded` as the SDK's props
 * spell the attributes, `Props` each widget's props.
 */
export function describeStandardAttributes<Forwarded, Props extends Record<WidgetName, object>>(
  glue: StandardAttributeGlue<Forwarded, Props>,
): void {
  const { mountWidget, staleOnRemoval } = glue;

  describe.each(widgetNames)("%s standard attributes", (widget) => {
    const tag = widgetTags[widget];

    it("forwards the class to the widget element", async () => {
      const { container } = await mountWidget(widget, { class: "probe" });
      expect(container.querySelector(tag)?.classList.contains("probe")).toBe(true);
    });

    it("forwards the style to the widget element", async () => {
      const { container } = await mountWidget(widget, { style: "color: red" });
      expect(container.querySelector(tag)?.style.color).toBe("red");
    });

    it("forwards the id to the widget element", async () => {
      const { container } = await mountWidget(widget, { id: "probe" });
      expect(container.querySelector(tag)?.id).toBe("probe");
    });

    it("forwards data attributes to the widget element", async () => {
      const { container } = await mountWidget(widget, { "data-testid": "probe" });
      expect(container.querySelector(tag)?.getAttribute("data-testid")).toBe("probe");
    });

    it("forwards aria attributes to the widget element", async () => {
      const { container } = await mountWidget(widget, { "aria-label": "probe" });
      expect(container.querySelector(tag)?.getAttribute("aria-label")).toBe("probe");
    });

    it("forwards the remaining standard attributes to the widget element", async () => {
      const { container } = await mountWidget(widget, {
        title: "probe",
        role: "region",
        tabindex: "3",
        hidden: "",
      });
      const element = container.querySelector(tag);
      expect(element?.title).toBe("probe");
      expect(element?.getAttribute("role")).toBe("region");
      expect(element?.getAttribute("tabindex")).toBe("3");
      expect(element?.hidden).toBe(true);
    });

    it("forwards the slot to the widget element", async () => {
      const { container } = await mountWidget(widget, { slot: "probe" });
      expect(container.querySelector(tag)?.getAttribute("slot")).toBe("probe");
    });

    it("renders a false aria or data attribute as the string false", async () => {
      const { container } = await mountWidget(widget, { "aria-hidden": false, "data-open": false });
      expect(container.querySelector(tag)?.getAttribute("aria-hidden")).toBe("false");
      expect(container.querySelector(tag)?.getAttribute("data-open")).toBe("false");
    });

    it("updates a forwarded attribute when the prop changes", async () => {
      const { container, update } = await mountWidget(widget, {
        class: "before",
        id: "before",
        title: "before",
        slot: "before",
        tabindex: "1",
        "aria-label": "before",
        "data-testid": "before",
      });
      await update({
        class: "after",
        id: "after",
        title: "after",
        slot: "after",
        tabindex: "2",
        "aria-label": "after",
        "data-testid": "after",
      });
      const element = container.querySelector(tag);
      expect(element?.classList.contains("before")).toBe(false);
      expect(element?.classList.contains("after")).toBe(true);
      for (const name of ["id", "title", "slot", "aria-label", "data-testid"]) {
        expect(element?.getAttribute(name)).toBe("after");
      }
      expect(element?.getAttribute("tabindex")).toBe("2");
    });

    it("removes a forwarded attribute when the prop is removed", async () => {
      const { container, update } = await mountWidget(widget, {
        class: "before",
        id: "before",
        title: "before",
        slot: "before",
        tabindex: "1",
        "aria-label": "before",
        "data-testid": "before",
      });
      const element = container.querySelector(tag);
      expect(element?.classList.contains("before")).toBe(true);
      for (const name of ["id", "title", "slot", "aria-label", "data-testid"]) {
        expect(element?.getAttribute(name)).toBe("before");
      }
      expect(element?.getAttribute("tabindex")).toBe("1");
      await update({});
      expect(element?.classList.contains("before")).toBe(false);
      for (const name of ["id", "title", "slot", "tabindex", "aria-label", "data-testid"]) {
        expect(element?.hasAttribute(name)).toBe(staleOnRemoval.includes(name));
      }
    });

    it("does not forward props outside the standard set", async () => {
      const { container } = await mountWidget(widget, {
        srcdoc: "probe",
        onclick: "probe",
        part: "probe",
        dir: "probe",
      });
      for (const name of ["srcdoc", "onclick", "part", "dir"]) {
        expect(container.querySelector(tag)?.hasAttribute(name)).toBe(false);
      }
    });

    it("gives access to the widget element through a ref", async () => {
      const { container, ref } = await mountWidget(widget, {});
      expect(ref()).toBe(container.querySelector(tag));
      expect(ref()?.tagName.toLowerCase()).toBe(tag);
    });

    // Both are proven where the SDK calls describeStandardAttributes: its
    // `accepted` and `rejected` type-check only when the props are right.
    it("accepts the standard attributes in its props", () => {
      expect(glue.accepted).toBe(true);
    });

    it("rejects the attributes it does not forward in its props", () => {
      expect(glue.rejected).toBe(true);
    });
  });
}
