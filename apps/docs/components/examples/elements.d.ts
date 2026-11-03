/// <reference types="@zitadel/components/jsx" />

// JSX for the atoms the examples render (atoms.tsx). The package types its
// orchestrators for React (`@zitadel/components/jsx`, referenced above), not
// its atoms, so these come from the examples' props, which are the atoms' own
// properties, as apps/website/app/zl-elements.d.ts does for the showcase.
import type { HTMLAttributes } from "react";

import type {
  AlertExampleProps,
  ButtonExampleProps,
  CheckboxExampleProps,
  FieldExampleProps,
  PillExampleProps,
} from "./atoms";

type Atom<Properties> = HTMLAttributes<HTMLElement> & Properties;

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "zl-alert": Atom<Omit<AlertExampleProps, "message">>;
      "zl-button": Atom<ButtonExampleProps>;
      "zl-checkbox": Atom<CheckboxExampleProps>;
      "zl-field": Atom<FieldExampleProps>;
      "zl-pill": Atom<Omit<PillExampleProps, "text">>;
    }
  }
}
