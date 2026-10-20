import type { ElementRef } from "@angular/core";
import type { ZitadelLogout as ZitadelLogoutElement } from "@zitadel/components";
import type { ZitadelSessionErrorDetail, ZitadelSignoutDetail } from "@zitadel/sdk-core/types";

import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  Output,
  ViewChild,
} from "@angular/core";

import type { ZitadelProject } from "./config";

import "@zitadel/components";

/**
 * Angular wrapper for the `<zitadel-logout>` Lit web component. See
 * {@link ZitadelLoginComponent} for the strategy. The widget's
 * `zitadel-signout` event is re-emitted with its detail as the `signout`
 * output, and `zitadel-session-error` as `sessionError`. The underlying `<zitadel-logout>` custom element is exposed via the
 * {@link element} getter (the Angular analogue of React's `forwardRef`).
 *
 * ```html
 * <zitadel-auth-logout [project]="project" postSignOutUrl="/login"
 *   (signout)="onSignout($event)" />
 * ```
 */
@Component({
  selector: "zitadel-auth-logout",
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<zitadel-logout
    #el
    [project]="project"
    [projectId]="projectId"
    [proxyPath]="proxyPath"
    [attr.project-id]="project?.projectId ?? projectId ?? null"
    [attr.proxy-path]="project?.proxyPath ?? proxyPath ?? null"
    [attr.url]="project?.url ?? null"
    [attr.post-sign-out-url]="postSignOutUrl"
    [attr.theme]="theme ?? null"
    (zitadel-signout)="onSignout($event)"
    (zitadel-session-error)="onSessionError($event)"
  ></zitadel-logout>`,
})
export class ZitadelLogoutComponent {
  @Input() project?: ZitadelProject;
  @Input() projectId?: string;
  @Input() proxyPath?: string;
  @Input() postSignOutUrl?: string;
  @Input() theme?: "light" | "dark" | "auto";
  @Output() signout = new EventEmitter<ZitadelSignoutDetail>();
  @Output() sessionError = new EventEmitter<ZitadelSessionErrorDetail>();

  @ViewChild("el") private elementRef?: ElementRef<ZitadelLogoutElement>;

  /** The underlying `<zitadel-logout>` custom element, or `null` before view init. */
  get element(): ZitadelLogoutElement | null {
    return this.elementRef?.nativeElement ?? null;
  }

  onSignout(event: Event): void {
    if (event instanceof CustomEvent) this.signout.emit(event.detail);
  }

  onSessionError(event: Event): void {
    this.sessionError.emit((event as CustomEvent<ZitadelSessionErrorDetail>).detail);
  }
}
