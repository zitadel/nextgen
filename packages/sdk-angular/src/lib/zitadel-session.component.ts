import type { ElementRef } from "@angular/core";
import type { ZitadelSession as ZitadelSessionElement } from "@zitadel/components";
import type { ZitadelContinueDetail, ZitadelSignoutDetail } from "@zitadel/sdk-core/types";

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
 * Angular wrapper for the `<zitadel-session>` Lit web component — the
 * post-sign-in "signed in as" card. See {@link ZitadelLoginComponent} for the
 * strategy. The widget's `zitadel-continue` and `zitadel-signout` events are
 * re-emitted with their detail as the `continue` and `signout` outputs. The
 * underlying `<zitadel-session>` custom element is exposed via the
 * {@link element} getter.
 *
 * ```html
 * <zitadel-auth-session [project]="project" continueUrl="/" postSignOutUrl="/login"
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
    [attr.continue-url]="continueUrl"
    [attr.post-sign-out-url]="postSignOutUrl"
    [attr.heading]="heading"
    [attr.continue-label]="continueLabel"
    [attr.logout-label]="logoutLabel"
    (zitadel-continue)="onContinue($event)"
    (zitadel-signout)="onSignout($event)"
  ></zitadel-session>`,
})
export class ZitadelSessionComponent {
  @Input() project?: ZitadelProject;
  @Input() projectId?: string;
  @Input() proxyPath?: string;
  @Input() continueUrl?: string;
  @Input() postSignOutUrl?: string;
  @Input() heading?: string;
  @Input() continueLabel?: string;
  @Input() logoutLabel?: string;
  @Output() continue = new EventEmitter<ZitadelContinueDetail>();
  @Output() signout = new EventEmitter<ZitadelSignoutDetail>();

  @ViewChild("el") private elementRef?: ElementRef<ZitadelSessionElement>;

  /** The underlying `<zitadel-session>` custom element, or `null` before view init. */
  get element(): ZitadelSessionElement | null {
    return this.elementRef?.nativeElement ?? null;
  }

  onContinue(event: Event): void {
    this.continue.emit((event as CustomEvent<ZitadelContinueDetail>).detail);
  }

  onSignout(event: Event): void {
    this.signout.emit((event as CustomEvent<ZitadelSignoutDetail>).detail);
  }
}
