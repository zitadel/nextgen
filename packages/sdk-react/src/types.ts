import type { StandardAttributeProps } from "@zitadel/sdk-core/types";
import type * as React from "react";

export type {
  CreateFlowBodyPurpose,
  ZitadelFlowCompleteDetail,
  ZitadelFlowErrorDetail,
  ZitadelFlowInputDetail,
  ZitadelFlowRedirectDetail,
  ZitadelFlowStepDetail,
  ZitadelLoginConfig,
  ZitadelLoginHandlers,
  ZitadelLoginProps,
  ZitadelLogoutConfig,
  ZitadelLogoutHandlers,
  ZitadelLogoutProps,
  ZitadelNavigationDetail,
  ZitadelSessionConfig,
  ZitadelSessionHandlers,
  ZitadelSessionProps,
  ZitadelSignoutDetail,
} from "@zitadel/sdk-core/types";

/**
 * The standard HTML attributes (`className`, `style`, `id`, `title`, `slot`,
 * `hidden`, `role`, `tabIndex`, `data-*` and `aria-*`) a widget wrapper accepts
 * besides its own props. They are passed to the widget element, so you can
 * position, style and label the widget without an extra wrapper element.
 *
 * Nothing else reaches the element: the type admits only these, so a prop the
 * type accepts is never silently dropped, and any other prop is ignored.
 */
export type ZitadelWidgetAttributes = StandardAttributeProps<React.HTMLAttributes<HTMLElement>>;
