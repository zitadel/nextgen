import type { ElementRef } from "@angular/core";
import type { ZitadelLogin as ZitadelLoginElement } from "@zitadel/components";
import type {
  CreateFlowBodyPurpose,
  ZitadelFlowCompleteDetail,
  ZitadelFlowRedirectDetail,
  ZitadelFlowErrorDetail,
  ZitadelFlowInputDetail,
  ZitadelFlowStepDetail,
} from "@zitadel/sdk-core/types";

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

// Registers <zitadel-login> / <zitadel-logout> with the browser.
import "@zitadel/components";

/**
 * Angular wrapper for the `<zitadel-login>` Lit web component.
 *
 * Uses a distinct selector (`zitadel-auth-login`) and renders the real custom
 * element in its template under `CUSTOM_ELEMENTS_SCHEMA`. The `project` handle
 * (from `configureZitadel(...)`) is bound as a DOM **property** via `[project]`,
 * as are the discrete `projectId` / `proxyPath` the element reads when no handle
 * is supplied. The widget's configuration is also written as attributes (from
 * `widgetAttributes` in `@zitadel/sdk-core`, applied on every change-detection
 * pass) so a server-rendered page carries it before hydration. The widget's `zitadel-*` events are re-emitted with their
 * detail as the `flowStep` / `flowInput` / `flowComplete` / `flowError` outputs.
 *
 * The underlying `<zitadel-login>` custom element is exposed via the
 * {@link element} getter so a consumer holding the component (e.g. via
 * `@ViewChild(ZitadelLoginComponent)`) can reach the real DOM element — the
 * Angular analogue of React's `forwardRef`.
 *
 * ```html
 * <zitadel-auth-login [project]="project" purpose="login" postSignInUrl="/"
 *   (flowComplete)="onComplete($event)" />
 * ```
 */
@Component({
  selector: "zitadel-auth-login",
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<zitadel-login
    #el
    [project]="project"
    [projectId]="projectId"
    [proxyPath]="proxyPath"
    [locales]="locales"
    [lang]="lang"
    [suppressHeader]="suppressHeader"
    [suppressPasswordToggle]="suppressPasswordToggle"
    (zitadel-flow-step)="onFlowStep($event)"
    (zitadel-flow-input)="onFlowInput($event)"
    (zitadel-flow-complete)="onFlowComplete($event)"
    (zitadel-flow-redirect)="onFlowRedirect($event)"
    (zitadel-flow-error)="onFlowError($event)"
  ></zitadel-login>`,
})
export class ZitadelLoginComponent implements DoCheck {
  @Input() project?: ZitadelProject;
  @Input() projectId?: string;
  @Input() proxyPath?: string;
  @Input() purpose: CreateFlowBodyPurpose = "login";
  @Input() flowName?: string;
  @Input() postSignInUrl?: string;
  @Input() resumeFlowId?: string | null;
  @Input() locales?: Record<string, Partial<Record<string, string>>>;
  @Input() lang?: string;
  @Input() variant?: "widget" | "page";
  @Input() theme?: "light" | "dark" | "auto";
  @Input() suppressHeader?: boolean;
  @Input() suppressPasswordToggle?: boolean;
  @Output() flowStep = new EventEmitter<ZitadelFlowStepDetail>();
  @Output() flowInput = new EventEmitter<ZitadelFlowInputDetail>();
  @Output() flowComplete = new EventEmitter<ZitadelFlowCompleteDetail>();

  @Output() flowRedirect = new EventEmitter<ZitadelFlowRedirectDetail>();
  @Output() flowError = new EventEmitter<ZitadelFlowErrorDetail>();

  @ViewChild("el", { static: true }) private elementRef?: ElementRef<ZitadelLoginElement>;

  ngDoCheck(): void {
    if (this.elementRef)
      writeAttributes(this.elementRef.nativeElement, widgetAttributes("login", this));
  }

  /** The underlying `<zitadel-login>` custom element, or `null` before view init. */
  get element(): ZitadelLoginElement | null {
    return this.elementRef?.nativeElement ?? null;
  }

  onFlowStep(event: Event): void {
    this.flowStep.emit((event as CustomEvent<ZitadelFlowStepDetail>).detail);
  }

  onFlowInput(event: Event): void {
    this.flowInput.emit((event as CustomEvent<ZitadelFlowInputDetail>).detail);
  }

  onFlowComplete(event: Event): void {
    this.flowComplete.emit((event as CustomEvent<ZitadelFlowCompleteDetail>).detail);
  }

  onFlowRedirect(event: Event): void {
    this.flowRedirect.emit((event as CustomEvent<ZitadelFlowRedirectDetail>).detail);
  }

  onFlowError(event: Event): void {
    this.flowError.emit((event as CustomEvent<ZitadelFlowErrorDetail>).detail);
  }
}
