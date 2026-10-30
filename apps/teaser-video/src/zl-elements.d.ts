// JSX for the atoms of @zitadel/components the scenes render. The package
// types its orchestrators for React (`@zitadel/components/jsx`), not its
// atoms; the property types come from the atoms' classes, so a property the
// package renames fails the typecheck here.
import type {
  ZlAccount,
  ZlAlert,
  ZlAvatar,
  ZlButton,
  ZlCard,
  ZlCheckbox,
  ZlField,
  ZlSsoProviders,
} from "@zitadel/components/atoms";
import type { Attributes, HTMLAttributes, Ref } from "react";

type Atom<Element, Properties> = Attributes &
  HTMLAttributes<HTMLElement> &
  Partial<Properties> & { ref?: Ref<Element> };

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "zl-account": Atom<ZlAccount, Pick<ZlAccount, "identifier" | "label" | "avatar">>;
      "zl-alert": Atom<ZlAlert, Pick<ZlAlert, "severity" | "heading">>;
      "zl-avatar": Atom<ZlAvatar, Pick<ZlAvatar, "seed">>;
      "zl-button": Atom<
        ZlButton,
        Pick<ZlButton, "hierarchy" | "size" | "type" | "label" | "block" | "loading">
      >;
      "zl-card": Atom<ZlCard, Pick<ZlCard, "compact">>;
      "zl-checkbox": Atom<ZlCheckbox, Pick<ZlCheckbox, "label" | "checked">>;
      "zl-field": Atom<
        ZlField,
        Pick<
          ZlField,
          | "label"
          | "type"
          | "value"
          | "placeholder"
          | "autocomplete"
          | "required"
          | "error"
          | "success"
          | "invalid"
        >
      >;
      "zl-sso-providers": Atom<ZlSsoProviders, Pick<ZlSsoProviders, "providers" | "labelFormat">>;
    }
  }
}
