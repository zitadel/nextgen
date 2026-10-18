import type { ZitadelSession as ZitadelSessionElement } from "@zitadel/components";
import type { ZitadelSessionErrorDetail, ZitadelSignoutDetail } from "@zitadel/sdk-core/types";

import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  DestroyRef,
  ElementRef,
  inject,
  EventEmitter,
  Input,
  Output,
  ViewChild,
} from "@angular/core";

import type { ZitadelProject } from "./config";

import "@zitadel/components";

/**
 * Angular wrapper for the `<zitadel-session>` Lit web component — the
 * post-sign-in "signed in as" card. See {@link ZitadelLoginComponent} for the
 * strategy. The widget's `zitadel-signout` event is re-emitted with its detail
 * as the `signout` output, and `zitadel-session-error` as `sessionError`. The underlying `<zitadel-session>` custom element is
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
    [attr.post-sign-out-url]="postSignOutUrl"
    [attr.heading]="heading"
    [attr.logout-label]="logoutLabel"
    [attr.variant]="variant ?? null"
    [attr.theme]="theme ?? null"
    [suppressHeader]="suppressHeader"
  ></zitadel-session>`,
})
export class ZitadelSessionComponent {
  @Input() project?: ZitadelProject;
  @Input() projectId?: string;
  @Input() proxyPath?: string;
  @Input() postSignOutUrl?: string;
  @Input() heading?: string;
  @Input() logoutLabel?: string;
  @Input() variant?: "widget" | "page";
  @Input() theme?: "light" | "dark" | "auto";
  @Input() suppressHeader?: boolean;
  @Output() signout = new EventEmitter<ZitadelSignoutDetail>();
  @Output() sessionError = new EventEmitter<ZitadelSessionErrorDetail>();

  @ViewChild("el") private elementRef?: ElementRef<ZitadelSessionElement>;

  constructor() {
    // The widget can raise `zitadel-signout` / `zitadel-session-error` the
    // moment it connects, before this view has finished initialising, and a
    // template `(event)` binding is only registered after the element is
    // attached. Listening on the host in the capture phase is set up when the
    // component is created, so such an early event is delivered too.
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const onSignout = (event: Event): void => this.onSignout(event);
    const onSessionError = (event: Event): void => this.onSessionError(event);
    host.addEventListener("zitadel-signout", onSignout, true);
    host.addEventListener("zitadel-session-error", onSessionError, true);
    inject(DestroyRef).onDestroy(() => {
      host.removeEventListener("zitadel-signout", onSignout, true);
      host.removeEventListener("zitadel-session-error", onSessionError, true);
    });
  }

  /** The underlying `<zitadel-session>` custom element, or `null` before view init. */
  get element(): ZitadelSessionElement | null {
    return this.elementRef?.nativeElement ?? null;
  }

  onSignout(event: Event): void {
    this.signout.emit((event as CustomEvent<ZitadelSignoutDetail>).detail);
  }

  onSessionError(event: Event): void {
    this.sessionError.emit((event as CustomEvent<ZitadelSessionErrorDetail>).detail);
  }
}
