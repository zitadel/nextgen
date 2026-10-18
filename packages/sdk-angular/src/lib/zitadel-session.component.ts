import type { ElementRef } from "@angular/core";
import type { ZitadelSession as ZitadelSessionElement } from "@zitadel/components";
import type { ZitadelSignoutDetail } from "@zitadel/sdk-core/types";

import { widgetAttributes } from "@zitadel/sdk-core/attributes";
import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  type DoCheck,
  EventEmitter,
  Input,
  Output,
  ViewChild,
} from "@angular/core";

import type { ZitadelProject } from "./config";
import { writeAttributes } from "./attributes";

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
    [suppressHeader]="suppressHeader"
    (zitadel-signout)="onSignout($event)"
  ></zitadel-session>`,
})
export class ZitadelSessionComponent implements DoCheck {
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

  @ViewChild("el", { static: true }) private elementRef?: ElementRef<ZitadelSessionElement>;

  ngDoCheck(): void {
    if (this.elementRef)
      writeAttributes(this.elementRef.nativeElement, widgetAttributes("session", this));
  }

  /** The underlying `<zitadel-session>` custom element, or `null` before view init. */
  get element(): ZitadelSessionElement | null {
    return this.elementRef?.nativeElement ?? null;
  }

  onSignout(event: Event): void {
    this.signout.emit((event as CustomEvent<ZitadelSignoutDetail>).detail);
  }
}
