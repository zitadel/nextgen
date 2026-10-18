import type { ElementRef } from "@angular/core";
import type { ZitadelLogout as ZitadelLogoutElement } from "@zitadel/components";
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
 * Angular wrapper for the `<zitadel-logout>` Lit web component. See
 * {@link ZitadelLoginComponent} for the strategy. The widget's
 * `zitadel-signout` event is re-emitted with its detail as the `signout`
 * output. The underlying `<zitadel-logout>` custom element is exposed via the
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
    (zitadel-signout)="onSignout($event)"
  ></zitadel-logout>`,
})
export class ZitadelLogoutComponent implements DoCheck {
  @Input() project?: ZitadelProject;
  @Input() projectId?: string;
  @Input() proxyPath?: string;
  @Input() postSignOutUrl?: string;
  @Input() theme?: "light" | "dark" | "auto";
  @Output() signout = new EventEmitter<ZitadelSignoutDetail>();

  @ViewChild("el", { static: true }) private elementRef?: ElementRef<ZitadelLogoutElement>;

  ngDoCheck(): void {
    if (this.elementRef)
      writeAttributes(this.elementRef.nativeElement, widgetAttributes("logout", this));
  }

  /** The underlying `<zitadel-logout>` custom element, or `null` before view init. */
  get element(): ZitadelLogoutElement | null {
    return this.elementRef?.nativeElement ?? null;
  }

  onSignout(event: Event): void {
    this.signout.emit((event as CustomEvent<ZitadelSignoutDetail>).detail);
  }
}
