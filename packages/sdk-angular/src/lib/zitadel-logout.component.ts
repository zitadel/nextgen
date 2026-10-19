import type { ZitadelLogout as ZitadelLogoutElement } from "@zitadel/components";
import type { ZitadelSignoutDetail } from "@zitadel/sdk-core/types";

import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  EventEmitter,
  inject,
  Input,
  Output,
  ViewChild,
  type AfterViewInit,
  type OnDestroy,
} from "@angular/core";

import type { ZitadelProject } from "./config";
import { forwardHostAttributes } from "./host-attributes";

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
  // The tag only hosts the widget; its box is the widget element's own.
  styles: [":host { display: contents; }"],
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
  ></zitadel-logout>`,
})
export class ZitadelLogoutComponent implements AfterViewInit, OnDestroy {
  @Input() project?: ZitadelProject;
  @Input() projectId?: string;
  @Input() proxyPath?: string;
  @Input() postSignOutUrl?: string;
  @Input() theme?: "light" | "dark" | "auto";
  @Output() signout = new EventEmitter<ZitadelSignoutDetail>();

  @ViewChild("el") private elementRef?: ElementRef<ZitadelLogoutElement>;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private stopForwarding?: () => void;

  ngAfterViewInit(): void {
    const element = this.element;
    if (element) this.stopForwarding = forwardHostAttributes(this.host.nativeElement, element);
  }

  ngOnDestroy(): void {
    this.stopForwarding?.();
  }

  /** The underlying `<zitadel-logout>` custom element, or `null` before view init. */
  get element(): ZitadelLogoutElement | null {
    return this.elementRef?.nativeElement ?? null;
  }

  onSignout(event: Event): void {
    this.signout.emit((event as CustomEvent<ZitadelSignoutDetail>).detail);
  }
}
