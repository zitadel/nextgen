// JSX for the atoms of @zitadel/components that the brand playground renders
// (brand-preview.tsx). The package types its orchestrators for React
// (`@zitadel/components/jsx`), not its atoms; the property types come from the
// atoms' classes, so a property the package renames fails the typecheck here.
import type { ZlButton, ZlCard, ZlField } from "@zitadel/components/atoms";
import type { HTMLAttributes } from "react";

type Atom<Properties> = HTMLAttributes<HTMLElement> & Partial<Properties>;

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "zl-card": Atom<Pick<ZlCard, "compact">>;
      "zl-field": Atom<Pick<ZlField, "label" | "type" | "placeholder" | "autocomplete">>;
      "zl-button": Atom<Pick<ZlButton, "hierarchy" | "size" | "type" | "label" | "block">>;
    }
  }
}
