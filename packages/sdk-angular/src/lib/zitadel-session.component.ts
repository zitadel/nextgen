import type { ElementRef } from "@angular/core";
import type { ZitadelSession as ZitadelSessionElement } from "@zitadel/components";
import type { ZitadelSignoutDetail } from "@zitadel/sdk-core/types";

import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  Output,
  ViewChild,
} from "@angular/core";

import type { ZitadelProject } from "./config.js";

import "@zitadel/components";

/**
 * Angular wrapper for the `<zitadel-session>` Lit web component — the
 * post-sign-in "signed in as" card. See {@link ZitadelLoginComponent} for the
 * strategy. The widget's `zitadel-signout` event is re-emitted with its detail
 * as the `signout` output. The underlying `<zitadel-session>` custom element is
 * exposed via the {@link element} getter.
 *
 * ```html
 * <zitadel-auth-session [project]="project" postSignOutUrl="/login"
 *   (signout)="onSignout($event)" />
 * ```
 */
@Component({
  selector: "zitadel-auth-session",
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<zitadel-session
    #el
    [project]="project"
    [projectId]="projectId"
    [proxyPath]="proxyPath"
    [attr.project-id]="project?.projectId ?? projectId ?? null"
    [attr.proxy-path]="project?.proxyPath ?? proxyPath ?? null"
    [attr.url]="project?.url ?? null"
    [attr.post-sign-out-url]="postSignOutUrl"
    [attr.heading]="heading"
    [attr.logout-label]="logoutLabel"
    [attr.variant]="variant ?? null"
    [attr.theme]="theme ?? null"
    [suppressHeader]="suppressHeader"
    (zitadel-signout)="onSignout($event)"
  ></zitadel-session>`,
})
export class ZitadelSessionComponent {
  /**
   * The handle from {@link configureZitadel}. When set it wins over the discrete
   * `projectId` and `proxyPath`, as it does inside the element. Bound as a DOM
   * property, and its `projectId`, `proxyPath` and `url` are also written as
   * attributes so server-rendered markup carries them before hydration.
   */
  @Input() project?: ZitadelProject;
  /**
   * Project id, read only when no `project` handle is set. Written as the
   * `project-id` attribute so it survives server rendering. Unset leaves the widget
   * to fall back to the globally configured project.
   */
  @Input() projectId?: string;
  /**
   * Same-origin path the widget calls, read only when no `project` handle is set.
   * Written as the `proxy-path` attribute. Unset means `"/__nextgen"`, the
   * same-origin proxy that fronts the API.
   */
  @Input() proxyPath?: string;
  /**
   * Where to navigate after sign-out. Unset leaves navigation to your `signout`
   * handler.
   */
  @Input() postSignOutUrl?: string;
  /**
   * Heading text override. Unset keeps the widget's `"Signed in as"`.
   */
  @Input() heading?: string;
  /**
   * Label of the sign-out action. Unset keeps the widget's `"Sign out"`.
   */
  @Input() logoutLabel?: string;
  /**
   * Surface variant. `"widget"` is content-sized and paints no page chrome;
   * `"page"` claims the viewport, paints the surface background and loads the brand
   * font. Unset keeps the widget's default, `"widget"`.
   */
  @Input() variant?: "widget" | "page";
  /**
   * Colour mode: `"light"`, `"dark"` or `"auto"` (follows `prefers-color-scheme`).
   * Unset lets the widget decide from its own defaults.
   */
  @Input() theme?: "light" | "dark" | "auto";
  /**
   * Visually hides the widget's own heading block while keeping it in the
   * accessibility tree, for pages that already carry the heading. Unset keeps it
   * visible.
   */
  @Input() suppressHeader?: boolean;
  /**
   * Emits the `zitadel-signout` detail when the user signs out. The detail carries
   * `waitUntil(promise)`; call it to make the widget wait for your async work before
   * it navigates.
   */
  @Output() signout = new EventEmitter<ZitadelSignoutDetail>();

  @ViewChild("el") private elementRef?: ElementRef<ZitadelSessionElement>;

  /** The underlying `<zitadel-session>` custom element, or `null` before view init. */
  get element(): ZitadelSessionElement | null {
    return this.elementRef?.nativeElement ?? null;
  }

  /**
   * Re-emits a `zitadel-signout` DOM event's detail on {@link signout}.
   *
   * @param event - The DOM event; anything that is not a `CustomEvent` is ignored.
   */
  onSignout(event: Event): void {
    if (event instanceof CustomEvent) this.signout.emit(event.detail);
  }
}
