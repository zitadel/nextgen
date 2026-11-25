import type { ReactNode } from "react";

import type { AddonScreen, AddonScreenProps } from "@zitadel/console/addon";

/**
 * An add-on screen whose `Screen` is typed by what its `load` resolves to.
 * The contract erases the data's type; this keeps the two in step.
 */
export function screen<Data>(
  definition: Omit<AddonScreen, "load" | "Screen"> & {
    load: () => Promise<Data>;
    Screen: (props: AddonScreenProps<Data>) => ReactNode;
  },
): AddonScreen {
  return definition;
}
