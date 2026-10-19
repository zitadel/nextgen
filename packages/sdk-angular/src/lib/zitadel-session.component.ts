import type { ZitadelSession as ZitadelSessionElement } from "@zitadel/components";
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
  // The tag only hosts the widget; its box is the widget element's own.
  styles: [":host { display: contents; }"],
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
export class ZitadelSessionComponent implements AfterViewInit, OnDestroy {
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

  @ViewChild("el") private elementRef?: ElementRef<ZitadelSessionElement>;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private stopForwarding?: () => void;

  ngAfterViewInit(): void {
    const element = this.element;
    if (element) this.stopForwarding = forwardHostAttributes(this.host.nativeElement, element);
  }

  ngOnDestroy(): void {
    this.stopForwarding?.();
  }

  /** The underlying `<zitadel-session>` custom element, or `null` before view init. */
  get element(): ZitadelSessionElement | null {
    return this.elementRef?.nativeElement ?? null;
  }

  onSignout(event: Event): void {
    this.signout.emit((event as CustomEvent<ZitadelSignoutDetail>).detail);
  }
}
