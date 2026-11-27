import { describe, expect, it } from "vitest";

import BROWSER_DEFAULTS from "./browser-defaults.json";
import { keyOf, type QualifiedName, type TemplateConfig, templateConfig } from "./config.js";
import { NativeSanitiser } from "./native.js";

const supported = NativeSanitiser.isSupported();

/**
 * A configuration as sorted keys, so two can be compared regardless of order.
 *
 * @param config - A configuration in the Sanitizer API's `get()` shape.
 * @returns Its elements, attributes and flags as sorted keys.
 */
function normalise(config: TemplateConfig) {
  const names = (list: readonly QualifiedName[] | undefined) => (list ?? []).map(keyOf).sort();
  return {
    elements: config.elements
      .map((element) => ({
        key: keyOf(element),
        attributes: names(element.attributes),
        removeAttributes: names(element.removeAttributes),
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    attributes: names(config.attributes),
    replaceWithChildrenElements: names(config.replaceWithChildrenElements),
    dataAttributes: config.dataAttributes,
    comments: config.comments,
  };
}

describe("templateConfig", () => {
  it.runIf(supported)("starts from what this browser's own defaults are", () => {
    expect(normalise(BROWSER_DEFAULTS as unknown as TemplateConfig)).toEqual(
      normalise(new Sanitizer().get() as unknown as TemplateConfig),
    );
  });

  it.runIf(supported)("is the configuration NativeSanitiser gives the browser", () => {
    expect(normalise(templateConfig())).toEqual(
      normalise(NativeSanitiser.configure().get() as unknown as TemplateConfig),
    );
  });
});
