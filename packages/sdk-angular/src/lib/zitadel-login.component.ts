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

import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  Output,
  ViewChild,
} from "@angular/core";

import type { ZitadelProject } from "./config.js";

// Registers <zitadel-login> / <zitadel-logout> with the browser.
import "@zitadel/components";

/**
 * Angular wrapper for the `<zitadel-login>` Lit web component.
 *
 * Uses a distinct selector (`zitadel-auth-login`) and renders the real custom
 * element in its template under `CUSTOM_ELEMENTS_SCHEMA`. The `project` handle
 * (from `configureZitadel(...)`) is bound as a DOM **property** via `[project]`,
 * as are the discrete `projectId` / `proxyPath` the element reads when no handle
 * is supplied; `purpose` / `post-sign-in-url` are bound as attributes the Lit
 * element reads, and `project-id` / `proxy-path` / `url` are bound as attributes
 * too so a server-rendered page carries them before hydration (the handle wins over the discrete
 * inputs, as in the element). The widget's `zitadel-*` events are re-emitted with their
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
    [attr.project-id]="project?.projectId ?? projectId ?? null"
    [attr.proxy-path]="project?.proxyPath ?? proxyPath ?? null"
    [attr.url]="project?.url ?? null"
    [locales]="locales"
    [attr.lang]="lang ?? null"
    [attr.purpose]="purpose"
    [attr.flow-name]="flowName"
    [attr.post-sign-in-url]="postSignInUrl"
    [forcePostSignInUrl]="forcePostSignInUrl"
    [attr.resume-flow-id]="resumeFlowId"
    [attr.variant]="variant ?? null"
    [attr.theme]="theme ?? null"
    [suppressHeader]="suppressHeader"
    [suppressPasswordToggle]="suppressPasswordToggle"
    (zitadel-flow-step)="onFlowStep($event)"
    (zitadel-flow-input)="onFlowInput($event)"
    (zitadel-flow-complete)="onFlowComplete($event)"
    (zitadel-flow-redirect)="onFlowRedirect($event)"
    (zitadel-flow-error)="onFlowError($event)"
  ></zitadel-login>`,
})
export class ZitadelLoginComponent {
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
   * Purpose of the flow the widget starts. Defaults to `"login"`. Ignored when
   * `resumeFlowId` resolves to an existing flow.
   */
  @Input() purpose: CreateFlowBodyPurpose = "login";
  /**
   * Name of the flow definition to run. Unset runs the project's default flow for
   * the `purpose`.
   */
  @Input() flowName?: string;
  /**
   * Where to navigate after a completed sign-in. When the page's `next` query
   * parameter names a path on the same origin, as the server SDKs' middleware sets
   * it for a signed-out visit to a protected route, the widget returns there
   * instead unless `forcePostSignInUrl` is set. Unset leaves navigation to your
   * `flowComplete` handler.
   */
  @Input() postSignInUrl?: string;
  /**
   * Navigates to `postSignInUrl` even when the page's `next` query parameter names
   * a path, for a page that uses `next` for something of its own. Defaults to
   * `false`.
   */
  @Input() forcePostSignInUrl?: boolean;
  /**
   * Id of an existing flow to resume instead of starting a new one. Unset, `null`
   * or `""` falls back to the `flow` query parameter, and an id that no longer
   * resolves starts a new flow. Written as an attribute so a server-rendered page
   * resumes the same flow on hydration.
   */
  @Input() resumeFlowId?: string | null;
  /**
   * Copy overrides merged over the built-in dictionaries, keyed by primary
   * language subtag, for example `{ en: { "identifier.title": "Welcome back" } }`.
   * Bound as a property, so it is not in server markup. Unset keeps the built-in
   * copy.
   */
  @Input() locales?: Record<string, Partial<Record<string, string>>>;
  /**
   * BCP-47 language override. Unset omits the `lang` attribute, so the widget uses
   * the browser language.
   */
  @Input() lang?: string;
  /**
   * Surface variant. `"widget"` is content-sized and paints no page chrome;
   * `"page"` claims the viewport, paints the surface background and loads the brand
   * font. Unset keeps the widget's default, `"widget"`.
   */
  @Input() variant?: "widget" | "page";
  /**
   * Colour mode: `"light"`, `"dark"` or `"auto"` (follows `prefers-color-scheme`).
   * Unset follows the tenant's branding theme, then the variant default (`"dark"`
   * for `"page"`, `"auto"` for `"widget"`).
   */
  @Input() theme?: "light" | "dark" | "auto";
  /**
   * Visually hides the widget's own heading block while keeping it in the
   * accessibility tree, for pages that already carry the heading. Unset keeps it
   * visible.
   */
  @Input() suppressHeader?: boolean;
  /**
   * Hides the show/hide button on password fields. Defaults to `false`.
   */
  @Input() suppressPasswordToggle?: boolean;
  /**
   * Emits the `zitadel-flow-step` detail each time the widget shows a step, the
   * first one included.
   */
  @Output() flowStep = new EventEmitter<ZitadelFlowStepDetail>();
  /**
   * Emits the `zitadel-flow-input` detail when the visitor edits a field.
   */
  @Output() flowInput = new EventEmitter<ZitadelFlowInputDetail>();
  /**
   * Emits the `zitadel-flow-complete` detail when the flow reaches a terminal step.
   * The detail carries `waitUntil(promise)`; call it to make the widget wait for
   * your async work before it navigates.
   */
  @Output() flowComplete = new EventEmitter<ZitadelFlowCompleteDetail>();

  /**
   * Emits the `zitadel-flow-redirect` detail when the widget hands the browser to
   * an identity provider; nobody is signed in yet. The detail carries
   * `waitUntil(promise)` to delay the navigation.
   */
  @Output() flowRedirect = new EventEmitter<ZitadelFlowRedirectDetail>();
  /**
   * Emits the `zitadel-flow-error` detail when the flow reports an error.
   */
  @Output() flowError = new EventEmitter<ZitadelFlowErrorDetail>();

  @ViewChild("el") private elementRef?: ElementRef<ZitadelLoginElement>;

  /** The underlying `<zitadel-login>` custom element, or `null` before view init. */
  get element(): ZitadelLoginElement | null {
    return this.elementRef?.nativeElement ?? null;
  }

  /**
   * Re-emits a `zitadel-flow-step` DOM event's detail on {@link flowStep}.
   *
   * @param event - The DOM event; anything that is not a `CustomEvent` is ignored.
   */
  onFlowStep(event: Event): void {
    if (event instanceof CustomEvent) this.flowStep.emit(event.detail);
  }

  /**
   * Re-emits a `zitadel-flow-input` DOM event's detail on {@link flowInput}.
   *
   * @param event - The DOM event; anything that is not a `CustomEvent` is ignored.
   */
  onFlowInput(event: Event): void {
    if (event instanceof CustomEvent) this.flowInput.emit(event.detail);
  }

  /**
   * Re-emits a `zitadel-flow-complete` DOM event's detail on {@link flowComplete}.
   *
   * @param event - The DOM event; anything that is not a `CustomEvent` is ignored.
   */
  onFlowComplete(event: Event): void {
    if (event instanceof CustomEvent) this.flowComplete.emit(event.detail);
  }

  /**
   * Re-emits a `zitadel-flow-redirect` DOM event's detail on {@link flowRedirect}.
   *
   * @param event - The DOM event; anything that is not a `CustomEvent` is ignored.
   */
  onFlowRedirect(event: Event): void {
    if (event instanceof CustomEvent) this.flowRedirect.emit(event.detail);
  }

  /**
   * Re-emits a `zitadel-flow-error` DOM event's detail on {@link flowError}.
   *
   * @param event - The DOM event; anything that is not a `CustomEvent` is ignored.
   */
  onFlowError(event: Event): void {
    if (event instanceof CustomEvent) this.flowError.emit(event.detail);
  }
}
