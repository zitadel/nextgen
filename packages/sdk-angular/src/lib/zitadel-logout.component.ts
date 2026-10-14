import type { ElementRef } from "@angular/core";
import type { ZitadelProject } from "@zitadel/api/config";
import type { ZitadelLogout as ZitadelLogoutElement } from "@zitadel/components";
import type {
  ZitadelSessionMissingDetail,
  ZitadelSignoutDetail,
  ZitadelLogoutConfig,
} from "@zitadel/sdk-core/types";

import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  Output,
  ViewChild,
} from "@angular/core";

import "@zitadel/components";

/**
 * Angular wrapper for the `<zitadel-logout>` Lit web component. See
 * {@link ZitadelLoginComponent} for the strategy. The widget's
 * `zitadel-signout` event is re-emitted with its detail as the `signout`
 * output, and `zitadel-session-missing` as `sessionMissing`. The underlying `<zitadel-logout>` custom element is exposed via the
 * {@link element} getter (the Angular analogue of React's `forwardRef`).
 *
 * Content placed inside the wrapper is projected into the element, so a
 * `<template>` child switches it to template mode (the consumer's own markup,
 * with a `data-action="logout"` trigger, instead of the avatar menu).
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
    [attr.project-id]="projectId"
    [attr.proxy-path]="proxyPath"
    [attr.post-sign-out-url]="postSignOutUrl"
    [attr.theme]="theme"
    (zitadel-signout)="onSignout($event)"
    (zitadel-session-missing)="onSessionMissing($event)"
  ><ng-content /></zitadel-logout>`,
})
export class ZitadelLogoutComponent implements ZitadelLogoutConfig {
  @Input() project?: ZitadelProject;
  @Input() projectId?: string;
  @Input() proxyPath?: string;
  @Input() postSignOutUrl?: string;
  @Input() theme?: "light" | "dark" | "auto";
  @Output() signout = new EventEmitter<ZitadelSignoutDetail>();
  @Output() sessionMissing = new EventEmitter<ZitadelSessionMissingDetail>();

  @ViewChild("el") private elementRef?: ElementRef<ZitadelLogoutElement>;

  /** The underlying `<zitadel-logout>` custom element, or `null` before view init. */
  get element(): ZitadelLogoutElement | null {
    return this.elementRef?.nativeElement ?? null;
  }

  onSignout(event: Event): void {
    this.signout.emit((event as CustomEvent<ZitadelSignoutDetail>).detail);
  }

  onSessionMissing(event: Event): void {
    this.sessionMissing.emit((event as CustomEvent<ZitadelSessionMissingDetail>).detail);
  }
}
